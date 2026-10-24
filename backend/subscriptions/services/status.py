"""Subscription status rules shared by the API, dashboard, reminders and profitability."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.utils import timezone

from ..models import AppSettings, Subscriber

ACTIVE = "active"
DUE_SOON = "due_soon"
OVERDUE = "overdue"
UNASSIGNED = "unassigned"
EXEMPT = "exempt"
PAUSED = "paused"
CANCELLED = "cancelled"

LABELS = {
    ACTIVE: "Active",
    DUE_SOON: "Due soon",
    OVERDUE: "Overdue",
    UNASSIGNED: "No plan",
    EXEMPT: "Exempt",
    PAUSED: "Paused",
    CANCELLED: "Cancelled",
}


@dataclass
class SubscriptionStatus:
    status: str
    days_until_due: int | None
    due_date: date | None
    monthly_revenue: Decimal

    @property
    def label(self) -> str:
        return LABELS.get(self.status, self.status)

    @property
    def needs_attention(self) -> bool:
        return self.status in (DUE_SOON, OVERDUE)


def today() -> date:
    return timezone.localdate()


def compute_status(sub: Subscriber, settings: AppSettings, on: date | None = None) -> SubscriptionStatus:
    on = on or today()
    if sub.status_override:
        return SubscriptionStatus(sub.status_override, None, sub.next_payment_date, Decimal("0"))
    if not sub.plan_id:
        return SubscriptionStatus(UNASSIGNED, None, None, Decimal("0"))

    monthly = sub.plan.monthly_price()
    due = sub.next_payment_date or on
    days = (due - on).days

    if days < -int(settings.grace_days or 0):
        status = OVERDUE
    elif days <= int(settings.due_soon_days or 0):
        status = DUE_SOON
    else:
        status = ACTIVE
    return SubscriptionStatus(status, days, due, monthly)
