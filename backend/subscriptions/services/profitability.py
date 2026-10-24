"""
Profitability: revenue versus actual usage per subscriber.

For each subscriber we compare the normalised monthly revenue of their plan
against the last 30 days of usage (Tracearr watch time / plays, Seerr requests).
If a monthly server cost is configured it is allocated proportionally to watch
time, which gives a per-subscriber margin. Revenue per hour watched is the
primary ranking when no cost is configured.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Sum
from django.utils import timezone

from ..models import AppSettings, Payment, Subscriber
from .status import compute_status

MS_PER_HOUR = 3_600_000


def _dec(value: float | Decimal | int) -> float:
    return float(round(Decimal(value), 2))


def compute_profitability(settings: AppSettings) -> dict[str, Any]:
    now = timezone.now()
    year_ago = (now - timedelta(days=365)).date()

    paid_12m = {
        row["subscriber_id"]: row["total"]
        for row in Payment.objects.filter(paid_at__gte=year_ago).values("subscriber_id").annotate(total=Sum("amount"))
    }
    paid_all = {
        row["subscriber_id"]: row["total"]
        for row in Payment.objects.values("subscriber_id").annotate(total=Sum("amount"))
    }

    subscribers = Subscriber.objects.select_related("plan", "usage").filter(removed_from_jellyfin=False)
    rows: list[dict[str, Any]] = []
    total_hours = 0.0
    for sub in subscribers:
        st = compute_status(sub, settings)
        usage = getattr(sub, "usage", None)
        hours_30d = (usage.watch_ms_30d if usage else 0) / MS_PER_HOUR
        plays_30d = usage.plays_30d if usage else 0
        transcodes = usage.transcode_plays_30d if usage else 0
        total_hours += hours_30d
        rows.append(
            {
                "subscriber_id": sub.pk,
                "jellyfin_id": sub.jellyfin_id,
                "name": sub.name,
                "plan": sub.plan.name if sub.plan else None,
                "status": st.status,
                "is_paying": sub.is_paying,
                "monthly_revenue": float(st.monthly_revenue),
                "paid_last_12m": _dec(paid_12m.get(sub.pk) or 0),
                "paid_total": _dec(paid_all.get(sub.pk) or 0),
                "hours_30d": round(hours_30d, 2),
                "hours_all": round((usage.watch_ms_all if usage else 0) / MS_PER_HOUR, 1),
                "plays_30d": plays_30d,
                "active_days_30d": usage.active_days_30d if usage else 0,
                "transcode_pct": round(100.0 * transcodes / plays_30d, 1) if plays_30d else 0.0,
                "requests_30d": usage.seerr_requests_30d if usage else 0,
                "requests_total": usage.seerr_requests_total if usage else 0,
                "last_watched_at": usage.last_watched_at.isoformat() if usage and usage.last_watched_at else None,
                "has_usage_data": bool(usage and usage.tracearr_user_id),
            }
        )

    cost = float(settings.monthly_server_cost or 0)
    for row in rows:
        share = (row["hours_30d"] / total_hours) if total_hours > 0 else 0.0
        allocated = cost * share
        revenue = row["monthly_revenue"]
        row["usage_share_pct"] = round(share * 100.0, 1)
        row["allocated_cost"] = round(allocated, 2)
        row["margin"] = round(revenue - allocated, 2)
        row["revenue_per_hour"] = round(revenue / row["hours_30d"], 2) if row["hours_30d"] > 0 else None
        row["requests_per_month_value"] = (
            round(revenue / row["requests_30d"], 2) if row["requests_30d"] > 0 else None
        )

    # Ranking: margin when a cost is configured, otherwise revenue per hour; no-usage payers rank first.
    def sort_key(row: dict[str, Any]):
        if cost > 0:
            return (-row["margin"], -row["monthly_revenue"])
        rph = row["revenue_per_hour"]
        if rph is None:
            return (0, -row["monthly_revenue"], row["hours_30d"])
        return (1, -rph, row["hours_30d"])

    rows.sort(key=sort_key)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index

    paying = [r for r in rows if r["is_paying"]]
    mrr = sum(r["monthly_revenue"] for r in paying)
    return {
        "currency": settings.currency,
        "monthly_server_cost": cost,
        "totals": {
            "subscribers": len(rows),
            "paying": len(paying),
            "mrr": round(mrr, 2),
            "hours_30d": round(total_hours, 1),
            "plays_30d": sum(r["plays_30d"] for r in rows),
            "requests_30d": sum(r["requests_30d"] for r in rows),
            "margin": round(mrr - cost, 2),
            "avg_revenue_per_hour": round(mrr / total_hours, 2) if total_hours > 0 else None,
            "free_hours_30d": round(sum(r["hours_30d"] for r in rows if not r["is_paying"]), 1),
        },
        "rows": rows,
    }
