"""
Synchronise subscribers and usage from Jellyfin, Tracearr and Seerr.

- Jellyfin is the source of truth for the subscriber list.
- Tracearr provides plays / watch time (7d, 30d, all-time), transcodes, last watched.
- Seerr provides request counts.

Matching: Tracearr accounts expose `external_user_id` (the Jellyfin user id) and
Seerr users expose `jellyfinUserId`; both are matched on the normalised id first
and on username as a fallback. Manual overrides on the Subscriber win.
"""

from __future__ import annotations

import logging
import threading
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Callable

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ..integrations.http import IntegrationError, normalize_id
from ..integrations.jellyfin import JellyfinClient
from ..integrations.seerr import SeerrClient
from ..integrations.tracearr import TracearrClient
from ..models import AppSettings, Subscriber, SyncRun, UsageSnapshot

logger = logging.getLogger(__name__)

USAGE_WINDOW_DAYS = 30
STALE_RUN_MINUTES = 30


def parse_dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.utc)
    return parsed


def is_sync_running() -> bool:
    cutoff = timezone.now() - timedelta(minutes=STALE_RUN_MINUTES)
    return SyncRun.objects.filter(finished_at__isnull=True, started_at__gte=cutoff).exists()


def start_sync_in_background(triggered_by: str = "manual") -> bool:
    if is_sync_running():
        return False
    thread = threading.Thread(target=_run_safely, args=(triggered_by,), daemon=True, name="sync")
    thread.start()
    return True


def _run_safely(triggered_by: str) -> None:
    try:
        run_sync(triggered_by)
    except Exception:  # noqa: BLE001
        logger.exception("Sync crashed")


def _guard(name: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        data = fn()
        return {"ok": True, **data}
    except IntegrationError as exc:
        logger.warning("%s sync failed: %s", name, exc)
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("%s sync crashed", name)
        return {"ok": False, "error": f"{name}: {exc}"}


def run_sync(triggered_by: str = "manual") -> SyncRun:
    settings = AppSettings.load()
    run = SyncRun.objects.create(triggered_by=triggered_by)
    result: dict[str, Any] = {}

    if settings.jellyfin_configured:
        result["jellyfin"] = _guard("Jellyfin", lambda: sync_jellyfin(settings))
    else:
        result["jellyfin"] = {"ok": False, "error": "Jellyfin is not configured"}

    if settings.tracearr_configured:
        result["tracearr"] = _guard("Tracearr", lambda: sync_tracearr(settings))
    else:
        result["tracearr"] = {"ok": True, "skipped": True}

    if settings.seerr_configured:
        result["seerr"] = _guard("Seerr", lambda: sync_seerr(settings))
    else:
        result["seerr"] = {"ok": True, "skipped": True}

    run.finished_at = timezone.now()
    run.ok = all(part.get("ok") for part in result.values())
    run.result = result
    run.save()

    settings.last_sync_at = run.finished_at
    settings.save(update_fields=["last_sync_at"])
    logger.info("Sync finished (%s): %s", triggered_by, result)
    return run


# --------------------------------------------------------------------------- Jellyfin


def sync_jellyfin(settings: AppSettings) -> dict[str, Any]:
    client = JellyfinClient(settings.jellyfin_url, settings.jellyfin_api_key)
    users = client.get_users()
    seen: set[str] = set()
    created = 0
    for user in users:
        jellyfin_id = user.get("Id")
        if not jellyfin_id:
            continue
        seen.add(jellyfin_id)
        policy = user.get("Policy") or {}
        _, was_created = Subscriber.objects.update_or_create(
            jellyfin_id=jellyfin_id,
            defaults={
                "name": user.get("Name") or jellyfin_id,
                "is_admin": bool(policy.get("IsAdministrator")),
                "is_disabled": bool(policy.get("IsDisabled")),
                "is_hidden": bool(policy.get("IsHidden")),
                "last_login_at": parse_dt(user.get("LastLoginDate")),
                "last_activity_at": parse_dt(user.get("LastActivityDate")),
                "primary_image_tag": user.get("PrimaryImageTag") or "",
                "removed_from_jellyfin": False,
            },
        )
        created += int(was_created)
    removed = (
        Subscriber.objects.exclude(jellyfin_id__in=seen).filter(removed_from_jellyfin=False).update(removed_from_jellyfin=True)
        if seen
        else 0
    )
    return {"users": len(users), "created": created, "removed": removed}


# --------------------------------------------------------------------------- Tracearr


def _empty_agg() -> dict[str, Any]:
    return {"plays": 0, "watch_ms": 0, "transcodes": 0, "days": set(), "last": None, "titles": Counter()}


def sync_tracearr(settings: AppSettings) -> dict[str, Any]:
    client = TracearrClient(settings.tracearr_url, settings.tracearr_api_key)
    identities = client.list_users(include_removed=True)

    by_id: dict[str, dict[str, Any]] = {}
    by_external: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for identity in identities:
        by_id[str(identity.get("id"))] = identity
        for account in identity.get("accounts") or []:
            server_type = (account.get("server_type") or "").lower()
            if server_type in ("jellyfin", "emby"):
                external = normalize_id(account.get("external_user_id"))
                if external:
                    by_external.setdefault(external, identity)
            username = (account.get("username") or "").strip().lower()
            if username:
                by_name.setdefault(username, identity)
        username = (identity.get("username") or "").strip().lower()
        if username:
            by_name.setdefault(username, identity)

    subscribers = list(Subscriber.objects.all())
    matched: dict[int, dict[str, Any]] = {}
    for sub in subscribers:
        identity = by_id.get(sub.tracearr_user_id) if sub.tracearr_user_id else None
        identity = identity or by_external.get(normalize_id(sub.jellyfin_id)) or by_name.get(sub.name.strip().lower())
        if identity:
            matched[sub.pk] = identity

    # One history pull for the usage window gives transcodes, active days, titles and last-watched.
    since = timezone.now() - timedelta(days=USAGE_WINDOW_DAYS)
    history = client.get_history(since=since)
    aggregate: dict[str, dict[str, Any]] = defaultdict(_empty_agg)
    for item in history:
        user_id = str((item.get("user") or {}).get("id") or "")
        if not user_id:
            continue
        agg = aggregate[user_id]
        agg["plays"] += 1
        agg["watch_ms"] += int(item.get("duration_ms") or 0)
        if item.get("is_transcode"):
            agg["transcodes"] += 1
        started = parse_dt(item.get("started_at"))
        if started:
            agg["days"].add(timezone.localtime(started).date())
            if agg["last"] is None or started > agg["last"]:
                agg["last"] = started
        title = item.get("show_title") or item.get("media_title")
        if title:
            agg["titles"][title] += 1

    now = timezone.now()
    stats_cache: dict[str, dict[str, Any]] = {}
    last_cache: dict[str, datetime | None] = {}
    errors = 0

    for sub in subscribers:
        snapshot, _ = UsageSnapshot.objects.get_or_create(subscriber=sub)
        identity = matched.get(sub.pk)
        if not identity:
            snapshot.tracearr_user_id = ""
            snapshot.tracearr_username = ""
            snapshot.tracearr_fetched_at = now
            snapshot.save()
            continue

        tracearr_id = str(identity.get("id"))
        if tracearr_id not in stats_cache:
            try:
                stats_cache[tracearr_id] = client.get_user_stats(tracearr_id) or {}
            except IntegrationError as exc:
                logger.warning("Tracearr stats failed for %s: %s", tracearr_id, exc)
                stats_cache[tracearr_id] = {}
                errors += 1
        stats = stats_cache[tracearr_id]
        windows = stats.get("windows") or {}
        agg = aggregate.get(tracearr_id) or _empty_agg()

        last_watched = agg["last"]
        if last_watched is None:
            # No play in the window: ask for the most recent play once per identity.
            if tracearr_id not in last_cache:
                try:
                    recent = client.get_user_history(tracearr_id, page_size=1)
                    last_cache[tracearr_id] = parse_dt(recent[0].get("started_at")) if recent else None
                except IntegrationError:
                    last_cache[tracearr_id] = None
            last_watched = last_cache[tracearr_id]

        def window(key: str, field: str, fallback: int) -> int:
            value = (windows.get(key) or {}).get(field)
            return int(value) if value is not None else fallback

        snapshot.tracearr_user_id = tracearr_id
        snapshot.tracearr_username = identity.get("username") or ""
        snapshot.plays_7d = window("last_7", "plays", 0)
        snapshot.plays_30d = window("last_30", "plays", agg["plays"])
        snapshot.plays_all = window("all_time", "plays", agg["plays"])
        snapshot.watch_ms_7d = window("last_7", "watch_time_ms", 0)
        snapshot.watch_ms_30d = window("last_30", "watch_time_ms", agg["watch_ms"])
        snapshot.watch_ms_all = window("all_time", "watch_time_ms", agg["watch_ms"])
        snapshot.transcode_plays_30d = agg["transcodes"]
        snapshot.active_days_30d = len(agg["days"])
        snapshot.last_watched_at = last_watched
        snapshot.top_genres = [
            {"genre": g.get("genre"), "plays": g.get("plays")} for g in (stats.get("top_genres") or [])[:5]
        ]
        snapshot.top_titles = [{"title": title, "plays": count} for title, count in agg["titles"].most_common(5)]
        snapshot.tracearr_fetched_at = now
        snapshot.save()

    return {
        "identities": len(identities),
        "matched": len(matched),
        "history_items": len(history),
        "stats_errors": errors,
    }


# --------------------------------------------------------------------------- Seerr


def sync_seerr(settings: AppSettings) -> dict[str, Any]:
    client = SeerrClient(settings.seerr_url, settings.seerr_api_key)
    users = client.list_users()

    by_id: dict[int, dict[str, Any]] = {}
    by_jellyfin: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for user in users:
        try:
            by_id[int(user.get("id"))] = user
        except (TypeError, ValueError):
            continue
        jellyfin_id = normalize_id(user.get("jellyfinUserId"))
        if jellyfin_id:
            by_jellyfin.setdefault(jellyfin_id, user)
        for key in ("jellyfinUsername", "username", "displayName", "plexUsername"):
            value = (user.get(key) or "").strip().lower()
            if value:
                by_name.setdefault(value, user)

    cutoff = timezone.now() - timedelta(days=USAGE_WINDOW_DAYS)
    now = timezone.now()
    matched = 0
    errors = 0

    for sub in Subscriber.objects.all():
        snapshot, _ = UsageSnapshot.objects.get_or_create(subscriber=sub)
        user = by_id.get(sub.seerr_user_id) if sub.seerr_user_id else None
        user = user or by_jellyfin.get(normalize_id(sub.jellyfin_id)) or by_name.get(sub.name.strip().lower())
        if not user:
            snapshot.seerr_user_id = None
            snapshot.seerr_username = ""
            snapshot.seerr_fetched_at = now
            snapshot.save()
            continue

        matched += 1
        snapshot.seerr_user_id = int(user["id"])
        snapshot.seerr_username = user.get("displayName") or user.get("jellyfinUsername") or user.get("username") or ""
        snapshot.seerr_requests_total = int(user.get("requestCount") or 0)

        recent = 0
        last: datetime | None = None
        try:
            for item in client.iter_user_requests(int(user["id"]), max_pages=4):
                created = parse_dt(item.get("createdAt"))
                if last is None:
                    last = created
                if created and created >= cutoff:
                    recent += 1
                else:
                    break
        except IntegrationError as exc:
            logger.warning("Seerr requests failed for user %s: %s", user.get("id"), exc)
            errors += 1
        snapshot.seerr_requests_30d = recent
        snapshot.seerr_last_request_at = last
        snapshot.seerr_fetched_at = now
        snapshot.save()

    return {"users": len(users), "matched": matched, "request_errors": errors}
