"""
Access enforcement: disable Jellyfin accounts whose subscription has lapsed.

An account is disabled (and logged out everywhere) when
  - a billed subscriber is overdue by more than grace_days + auto_disable_after_days, or
  - an exempt account's "exempt until" date has passed (status "expired").

An account that Tallyfin disabled is re-enabled automatically once the
subscriber is back in good standing (active, due soon, or exempt again),
typically right after a payment is recorded. Accounts disabled manually (in
Tallyfin or in Jellyfin itself) are never re-enabled automatically, and
Jellyfin administrators are never touched.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from django.utils import timezone

from ..integrations.http import IntegrationError
from ..integrations.jellyfin import JellyfinClient
from ..models import AccessEvent, AppSettings, Subscriber
from .notifications import configured_channels, send_notification
from .status import EXPIRED, GOOD_STANDING, OVERDUE, SubscriptionStatus, compute_status



def human_date(d) -> str:
    """Nov 7, 2026: the format the web UI uses, instead of ISO."""
    return f"{d:%b} {d.day}, {d.year}" if d else ""

logger = logging.getLogger(__name__)


def disable_reason(st: SubscriptionStatus, settings: AppSettings) -> str | None:
    """Why this subscriber should lose access right now, or None."""
    if st.status == EXPIRED:
        return f"exemption ended {human_date(st.due_date)}"
    if st.status == OVERDUE and st.days_until_due is not None:
        overdue_days = -st.days_until_due
        beyond_grace = overdue_days - int(settings.grace_days or 0)
        if beyond_grace >= max(int(settings.auto_disable_after_days or 0), 1):
            return f"{overdue_days} day{'s' if overdue_days != 1 else ''} overdue (was due {human_date(st.due_date)})"
    return None


def plan_actions(
    settings: AppSettings, on: date | None = None
) -> tuple[list[tuple[Subscriber, str]], list[tuple[Subscriber, str]]]:
    """Return (to_disable, to_enable) as (subscriber, reason) pairs, without touching Jellyfin."""
    on = on or timezone.localdate()
    to_disable: list[tuple[Subscriber, str]] = []
    to_enable: list[tuple[Subscriber, str]] = []
    for sub in Subscriber.objects.select_related("plan").filter(removed_from_jellyfin=False, is_admin=False):
        st = compute_status(sub, settings, on)
        if not sub.is_disabled:
            reason = disable_reason(st, settings)
            if reason:
                to_disable.append((sub, reason))
        elif sub.access_disabled_by_app and st.status in GOOD_STANDING:
            to_enable.append((sub, f"back in good standing ({st.label.lower()})"))
    return to_disable, to_enable


def disable_access(
    client: JellyfinClient, sub: Subscriber, reason: str, settings: AppSettings, automatic: bool = True
) -> AccessEvent:
    client.set_user_disabled(sub.jellyfin_id, True)
    counts = {"sessions_stopped": 0, "devices_removed": 0}
    try:
        counts = client.logout_user_everywhere(sub.jellyfin_id, message=settings.disable_message or None)
    except IntegrationError as exc:
        logger.warning("Disabled %s but could not end their sessions: %s", sub.name, exc)
    sub.is_disabled = True
    sub.access_disabled_by_app = automatic
    sub.access_disabled_at = timezone.now()
    sub.save(update_fields=["is_disabled", "access_disabled_by_app", "access_disabled_at", "updated_at"])
    event = AccessEvent.objects.create(subscriber=sub, action=AccessEvent.Action.DISABLED, automatic=automatic, reason=reason, **counts)
    logger.info("Disabled Jellyfin access for %s: %s (%s)", sub.name, reason, counts)
    return event


def enable_access(client: JellyfinClient, sub: Subscriber, reason: str, automatic: bool = True) -> AccessEvent:
    client.set_user_disabled(sub.jellyfin_id, False)
    sub.is_disabled = False
    sub.access_disabled_by_app = False
    sub.access_disabled_at = None
    sub.save(update_fields=["is_disabled", "access_disabled_by_app", "access_disabled_at", "updated_at"])
    event = AccessEvent.objects.create(subscriber=sub, action=AccessEvent.Action.ENABLED, automatic=automatic, reason=reason)
    logger.info("Restored Jellyfin access for %s: %s", sub.name, reason)
    return event


def restore_after_payment(sub: Subscriber, settings: AppSettings) -> AccessEvent | None:
    """Called right after a payment: re-enable immediately if Tallyfin had disabled the account."""
    if not (settings.auto_reenable_on_payment and settings.jellyfin_configured):
        return None
    if not (sub.is_disabled and sub.access_disabled_by_app):
        return None
    if compute_status(sub, settings).status not in GOOD_STANDING:
        return None
    client = JellyfinClient(settings.jellyfin_url, settings.jellyfin_api_key)
    return enable_access(client, sub, "payment recorded", automatic=True)


def _describe(sub: Subscriber, reason: str) -> dict[str, Any]:
    return {"subscriber_id": sub.pk, "name": sub.name, "reason": reason}


def run_enforcement(dry_run: bool = False, force: bool = False, only_ids: set[int] | None = None) -> dict[str, Any]:
    """Apply pending disables/re-enables.

    ``only_ids`` limits a manual run to the subscribers the admin saw and confirmed, so a list that
    changed between preview and confirmation never disables someone extra.
    """
    settings = AppSettings.load()
    if not settings.auto_disable_enabled and not force:
        return {"skipped": "automatic access enforcement is disabled", "disabled": [], "enabled": [], "errors": []}
    if not settings.jellyfin_configured:
        return {"skipped": "Jellyfin is not configured", "disabled": [], "enabled": [], "errors": []}

    to_disable, to_enable = plan_actions(settings)
    if only_ids is not None:
        to_disable = [(s, r) for s, r in to_disable if s.pk in only_ids]
        to_enable = [(s, r) for s, r in to_enable if s.pk in only_ids]
    result: dict[str, Any] = {"dry_run": dry_run, "disabled": [], "enabled": [], "errors": [], "failures": []}
    if dry_run:
        result["disabled"] = [_describe(s, r) for s, r in to_disable]
        result["enabled"] = [_describe(s, r) for s, r in to_enable]
        return result
    if not to_disable and not to_enable:
        return result

    client = JellyfinClient(settings.jellyfin_url, settings.jellyfin_api_key)
    for sub, reason in to_disable:
        try:
            event = disable_access(client, sub, reason, settings)
            result["disabled"].append(
                {**_describe(sub, reason), "sessions_stopped": event.sessions_stopped, "devices_removed": event.devices_removed}
            )
        except IntegrationError as exc:
            logger.warning("Could not disable %s: %s", sub.name, exc)
            result["errors"].append(f"Couldn't disable {sub.name}: {exc.message}")
            result["failures"].append({"subscriber_id": sub.pk, "name": sub.name, "action": "disable", "message": exc.message, "kind": exc.kind})
    for sub, reason in to_enable:
        try:
            enable_access(client, sub, reason)
            result["enabled"].append(_describe(sub, reason))
        except IntegrationError as exc:
            logger.warning("Could not re-enable %s: %s", sub.name, exc)
            result["errors"].append(f"Couldn't re-enable {sub.name}: {exc.message}")
            result["failures"].append({"subscriber_id": sub.pk, "name": sub.name, "action": "enable", "message": exc.message, "kind": exc.kind})

    if (result["disabled"] or result["enabled"]) and settings.notify_on_access_change and configured_channels(settings):
        lines = []
        if result["disabled"]:
            lines.append("ACCESS DISABLED")
            lines += [f"• {item['name']} — {item['reason']}" for item in result["disabled"]]
            lines.append("")
        if result["enabled"]:
            lines.append("ACCESS RESTORED")
            lines += [f"• {item['name']} — {item['reason']}" for item in result["enabled"]]
        parts = []
        if result["disabled"]:
            parts.append(f"{len(result['disabled'])} account{'s' if len(result['disabled']) != 1 else ''} disabled")
        if result["enabled"]:
            parts.append(f"{len(result['enabled'])} restored")
        result["notified"] = send_notification(settings, "Tallyfin: " + ", ".join(parts), "\n".join(lines).strip())
    return result
