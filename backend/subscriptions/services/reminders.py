"""
Payment reminders.

Each day (at the configured time) the scheduler collects every paying
subscriber whose due date triggers a reminder today: N days before (configurable
list), the due day itself, and overdue (first day after grace, then every N days).
All triggered items go out as a single digest to every configured channel, and a
ReminderLog row per (subscriber, kind, due date) prevents repeats.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from django.utils import timezone

from ..models import AppSettings, ReminderLog, Subscriber
from .notifications import configured_channels, send_notification
from .status import DUE_SOON, OVERDUE, compute_status

logger = logging.getLogger(__name__)


def _money(amount, currency: str) -> str:
    return f"{amount:.2f} {currency}"


def _paying_subscribers():
    return Subscriber.objects.select_related("plan").filter(
        plan__isnull=False, status_override="", removed_from_jellyfin=False
    )


def upcoming_items(settings: AppSettings, horizon_days: int = 14) -> list[dict[str, Any]]:
    """Everything overdue, due soon, or due within the horizon (for the dashboard)."""
    items = []
    for sub in _paying_subscribers():
        st = compute_status(sub, settings)
        if st.days_until_due is None:
            continue
        if st.status in (OVERDUE, DUE_SOON) or st.days_until_due <= horizon_days:
            items.append(_item(sub, st.status, st.due_date, st.days_until_due))
    items.sort(key=lambda i: (i["days_until_due"], i["name"].lower()))
    return items


def _item(sub: Subscriber, status: str, due_date: date | None, days: int, kind: str = "") -> dict[str, Any]:
    plan = sub.plan
    return {
        "subscriber_id": sub.pk,
        "jellyfin_id": sub.jellyfin_id,
        "name": sub.name,
        "plan": plan.name if plan else None,
        "amount": str(plan.price) if plan else None,
        "currency": plan.currency if plan else None,
        "due_date": due_date.isoformat() if due_date else None,
        "days_until_due": days,
        "status": status,
        "kind": kind,
    }


def _reminder_kind(days: int, settings: AppSettings) -> str | None:
    if days > 0:
        return f"due_in_{days}" if days in settings.reminder_days_list() else None
    if days == 0:
        return "due_today"
    overdue = -days - int(settings.grace_days or 0)
    if overdue < 1:
        return None
    every = int(settings.reminder_overdue_every_days or 0)
    if overdue == 1 or (every and overdue % every == 0):
        return f"overdue_{overdue}"
    return None


def pending_reminders(settings: AppSettings, on: date | None = None) -> list[dict[str, Any]]:
    on = on or timezone.localdate()
    pending = []
    for sub in _paying_subscribers():
        st = compute_status(sub, settings, on)
        if st.days_until_due is None or st.due_date is None:
            continue
        kind = _reminder_kind(st.days_until_due, settings)
        if not kind:
            continue
        if ReminderLog.objects.filter(subscriber=sub, kind=kind, due_date=st.due_date).exists():
            continue
        pending.append(_item(sub, st.status, st.due_date, st.days_until_due, kind))
    pending.sort(key=lambda i: (i["days_until_due"], i["name"].lower()))
    return pending


def build_digest(items: list[dict[str, Any]], on: date) -> tuple[str, str]:
    overdue = [i for i in items if i["days_until_due"] < 0]
    today_items = [i for i in items if i["days_until_due"] == 0]
    soon = [i for i in items if i["days_until_due"] > 0]

    parts = []
    if overdue:
        parts.append(f"{len(overdue)} overdue")
    if today_items:
        parts.append(f"{len(today_items)} due today")
    if soon:
        parts.append(f"{len(soon)} due soon")
    title = "Tallyfin: " + ", ".join(parts)

    lines = [f"Subscription reminders for {on:%A %d %B %Y}", ""]

    def describe(item: dict[str, Any]) -> str:
        plan = f"{item['plan']} ({_money(float(item['amount']), item['currency'])})" if item["plan"] else "no plan"
        return f"• {item['name']} — {plan}"

    if overdue:
        lines.append("OVERDUE")
        for item in overdue:
            days = -item["days_until_due"]
            lines.append(f"{describe(item)} — {days} day{'s' if days != 1 else ''} overdue (was due {_human(item['due_date'])})")
        lines.append("")
    if today_items:
        lines.append("DUE TODAY")
        for item in today_items:
            lines.append(describe(item))
        lines.append("")
    if soon:
        lines.append("DUE SOON")
        for item in soon:
            days = item["days_until_due"]
            lines.append(f"{describe(item)} — due in {days} day{'s' if days != 1 else ''} ({item['due_date']})")
        lines.append("")
    return title, "\n".join(lines).strip()


def run_reminders(force: bool = False, dry_run: bool = False) -> dict[str, Any]:
    settings = AppSettings.load()
    on = timezone.localdate()
    if not settings.reminders_enabled and not force:
        return {"sent": 0, "skipped": "reminders disabled"}

    items = pending_reminders(settings, on)
    if not items:
        return {"sent": 0, "items": []}

    title, message = build_digest(items, on)
    channels = configured_channels(settings)
    if dry_run:
        return {"sent": 0, "dry_run": True, "title": title, "message": message, "items": items}
    if not channels:
        return {"sent": 0, "pending": len(items), "warning": "No notification channel configured", "items": items}

    results = send_notification(settings, title, message, items)
    delivered = [channel for channel, outcome in results.items() if outcome == "ok"]
    if delivered:
        for item in items:
            ReminderLog.objects.get_or_create(
                subscriber_id=item["subscriber_id"],
                kind=item["kind"],
                due_date=date.fromisoformat(item["due_date"]),
                defaults={"channels": ",".join(delivered), "message": message},
            )
    logger.info("Reminders: %d items, channels=%s", len(items), results)
    return {"sent": len(items) if delivered else 0, "channels": results, "title": title, "message": message, "items": items}


def _human(iso: str | None) -> str:
    if not iso:
        return ""
    d = date.fromisoformat(iso)
    return f"{d:%b} {d.day}, {d.year}"
