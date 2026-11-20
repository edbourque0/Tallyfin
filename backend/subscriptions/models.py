"""
Data model.

- AppSettings: singleton row holding integration credentials, billing rules,
  reminder schedule and notification channels (all editable from the UI).
- Plan: a subscription product (price + duration).
- Subscriber: one row per Jellyfin user (synced), with the subscription state.
- Payment: ledger of payments received; recording one advances the due date.
- UsageSnapshot: last synced usage figures from Tracearr and Seerr.
- ReminderLog: which reminders were already sent (prevents duplicates).
- SyncRun: history of sync executions with per-service results.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.conf import settings as django_settings
from django.db import models

DAYS_PER_MONTH = Decimal("30.4375")


class AppSettings(models.Model):
    """Singleton settings row (pk=1)."""

    # Integrations
    jellyfin_url = models.CharField(max_length=500, blank=True, default="")
    jellyfin_api_key = models.CharField(max_length=500, blank=True, default="")
    tracearr_url = models.CharField(max_length=500, blank=True, default="")
    tracearr_api_key = models.CharField(max_length=500, blank=True, default="")
    seerr_url = models.CharField(max_length=500, blank=True, default="")
    seerr_api_key = models.CharField(max_length=500, blank=True, default="")

    # Billing rules
    currency = models.CharField(max_length=8, default="USD")
    due_soon_days = models.PositiveIntegerField(default=7)
    grace_days = models.PositiveIntegerField(default=0)
    monthly_server_cost = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0"), help_text="Other fixed monthly costs (optional)."
    )
    # Electricity: server_watts × server_hours_per_day × days per month × price per kWh
    electricity_price_per_kwh = models.DecimalField(max_digits=8, decimal_places=4, default=Decimal("0"))
    server_watts = models.PositiveIntegerField(default=0)
    server_hours_per_day = models.DecimalField(max_digits=4, decimal_places=1, default=Decimal("24"))

    # Sync
    sync_interval_minutes = models.PositiveIntegerField(default=60)

    # Reminders
    reminders_enabled = models.BooleanField(default=True)
    reminder_time = models.TimeField(default=django_settings.DEFAULT_REMINDER_TIME)
    reminder_days_before = models.CharField(max_length=100, default="7,3,1")
    reminder_overdue_every_days = models.PositiveIntegerField(default=3)

    # Notification channels (leave blank to disable a channel)
    discord_webhook_url = models.CharField(max_length=500, blank=True, default="")
    ntfy_url = models.CharField(max_length=500, blank=True, default="")
    ntfy_topic = models.CharField(max_length=200, blank=True, default="")
    ntfy_token = models.CharField(max_length=500, blank=True, default="")
    gotify_url = models.CharField(max_length=500, blank=True, default="")
    gotify_token = models.CharField(max_length=500, blank=True, default="")
    telegram_bot_token = models.CharField(max_length=500, blank=True, default="")
    telegram_chat_id = models.CharField(max_length=100, blank=True, default="")
    webhook_url = models.CharField(max_length=500, blank=True, default="")
    email_host = models.CharField(max_length=200, blank=True, default="")
    email_port = models.PositiveIntegerField(default=587)
    email_use_tls = models.BooleanField(default=True)
    email_user = models.CharField(max_length=200, blank=True, default="")
    email_password = models.CharField(max_length=500, blank=True, default="")
    email_from = models.CharField(max_length=200, blank=True, default="")
    email_to = models.CharField(max_length=500, blank=True, default="")

    # Access enforcement (disable the Jellyfin account when a subscription lapses)
    auto_disable_enabled = models.BooleanField(default=True)
    auto_disable_after_days = models.PositiveIntegerField(
        default=0, help_text="Extra days overdue (after the grace period) before the account is disabled."
    )
    auto_reenable_on_payment = models.BooleanField(default=True)
    notify_on_access_change = models.BooleanField(default=True)
    disable_message = models.CharField(
        max_length=300,
        blank=True,
        default="Your subscription to this server has expired. Contact the admin to renew your access.",
        help_text="Shown on the user's active Jellyfin sessions just before they are logged out.",
    )

    # Runtime state
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_reminder_run_date = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name = "App settings"
        verbose_name_plural = "App settings"

    SECRET_FIELDS = (
        "jellyfin_api_key",
        "tracearr_api_key",
        "seerr_api_key",
        "discord_webhook_url",
        "ntfy_token",
        "gotify_token",
        "telegram_bot_token",
        "webhook_url",
        "email_password",
    )

    @classmethod
    def load(cls) -> "AppSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @property
    def jellyfin_configured(self) -> bool:
        return bool(self.jellyfin_url and self.jellyfin_api_key)

    @property
    def tracearr_configured(self) -> bool:
        return bool(self.tracearr_url and self.tracearr_api_key)

    @property
    def seerr_configured(self) -> bool:
        return bool(self.seerr_url and self.seerr_api_key)

    def monthly_cost_breakdown(self) -> dict[str, float]:
        """Electricity (watts × hours/day × days/month × price per kWh) plus other fixed costs."""
        hours = min(max(Decimal(self.server_hours_per_day or 0), Decimal("0")), Decimal("24"))
        kwh_per_month = Decimal(self.server_watts or 0) / Decimal("1000") * hours * DAYS_PER_MONTH
        electricity = kwh_per_month * Decimal(self.electricity_price_per_kwh or 0)
        other = Decimal(self.monthly_server_cost or 0)
        return {
            "kwh_per_month": float(round(kwh_per_month, 1)),
            "electricity_cost": float(round(electricity, 2)),
            "other_costs": float(round(other, 2)),
            "total": float(round(electricity + other, 2)),
        }

    def reminder_days_list(self) -> list[int]:
        days: set[int] = set()
        for part in (self.reminder_days_before or "").split(","):
            part = part.strip()
            if part.isdigit():
                days.add(int(part))
        return sorted(days, reverse=True)

    def __str__(self) -> str:
        return "App settings"


class Plan(models.Model):
    class Unit(models.TextChoices):
        DAY = "day", "Day"
        WEEK = "week", "Week"
        MONTH = "month", "Month"
        YEAR = "year", "Year"

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    price = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="USD")
    duration_value = models.PositiveIntegerField(default=1)
    duration_unit = models.CharField(max_length=10, choices=Unit.choices, default=Unit.MONTH)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "price", "name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.price} {self.currency} / {self.duration_label})"

    @property
    def duration_label(self) -> str:
        unit = self.duration_unit
        if self.duration_value == 1:
            return unit
        return f"{self.duration_value} {unit}s"

    def duration_days(self) -> Decimal:
        factor = {
            self.Unit.DAY: Decimal("1"),
            self.Unit.WEEK: Decimal("7"),
            self.Unit.MONTH: DAYS_PER_MONTH,
            self.Unit.YEAR: Decimal("365.25"),
        }[self.Unit(self.duration_unit)]
        return factor * Decimal(self.duration_value)

    def monthly_price(self) -> Decimal:
        days = self.duration_days()
        if days <= 0:
            return Decimal("0")
        return (Decimal(self.price) / days * DAYS_PER_MONTH).quantize(Decimal("0.01"))

    def add_duration(self, start: date) -> date:
        """Return the date one plan period after start (calendar-aware)."""
        unit = self.Unit(self.duration_unit)
        if unit == self.Unit.DAY:
            return start + timedelta(days=self.duration_value)
        if unit == self.Unit.WEEK:
            return start + timedelta(weeks=self.duration_value)
        if unit == self.Unit.MONTH:
            return start + relativedelta(months=self.duration_value)
        return start + relativedelta(years=self.duration_value)


class Subscriber(models.Model):
    class Override(models.TextChoices):
        NONE = "", "None"
        EXEMPT = "exempt", "Exempt (free account)"
        PAUSED = "paused", "Paused"
        CANCELLED = "cancelled", "Cancelled"

    # Synced from Jellyfin
    jellyfin_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=200)
    is_admin = models.BooleanField(default=False)
    is_disabled = models.BooleanField(default=False)
    is_hidden = models.BooleanField(default=False)
    last_login_at = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    primary_image_tag = models.CharField(max_length=100, blank=True, default="")
    removed_from_jellyfin = models.BooleanField(default=False)

    # Subscription state (managed here)
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.SET_NULL, related_name="subscribers")
    subscription_start = models.DateField(null=True, blank=True)
    next_payment_date = models.DateField(null=True, blank=True)
    status_override = models.CharField(max_length=20, choices=Override.choices, blank=True, default="")
    exempt_until = models.DateField(
        null=True, blank=True, help_text="For exempt accounts: free access ends on this date (blank = indefinitely)."
    )
    access_disabled_by_app = models.BooleanField(default=False)
    access_disabled_at = models.DateTimeField(null=True, blank=True)
    email = models.CharField(max_length=200, blank=True, default="")
    contact = models.CharField(max_length=200, blank=True, default="", help_text="Discord handle, phone, etc.")
    notes = models.TextField(blank=True, default="")

    # Manual correlation overrides (normally auto-matched during sync)
    tracearr_user_id = models.CharField(max_length=64, blank=True, default="")
    seerr_user_id = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    @property
    def is_paying(self) -> bool:
        return bool(self.plan_id) and not self.status_override


class Payment(models.Model):
    subscriber = models.ForeignKey(Subscriber, on_delete=models.CASCADE, related_name="payments")
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="USD")
    paid_at = models.DateField()
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    method = models.CharField(max_length=50, blank=True, default="")
    note = models.TextField(blank=True, default="")
    # What recording this payment did to the subscriber's due date, so deleting it can undo exactly that.
    moved_due_date = models.BooleanField(default=False)
    replaced_due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at", "-id"]

    def __str__(self) -> str:
        return f"{self.subscriber} {self.amount} {self.currency} on {self.paid_at}"


class UsageSnapshot(models.Model):
    subscriber = models.OneToOneField(Subscriber, on_delete=models.CASCADE, related_name="usage")

    # Tracearr
    tracearr_user_id = models.CharField(max_length=64, blank=True, default="")
    tracearr_username = models.CharField(max_length=200, blank=True, default="")
    plays_7d = models.IntegerField(default=0)
    plays_30d = models.IntegerField(default=0)
    plays_all = models.IntegerField(default=0)
    watch_ms_7d = models.BigIntegerField(default=0)
    watch_ms_30d = models.BigIntegerField(default=0)
    watch_ms_all = models.BigIntegerField(default=0)
    transcode_plays_30d = models.IntegerField(default=0)
    active_days_30d = models.IntegerField(default=0)
    last_watched_at = models.DateTimeField(null=True, blank=True)
    top_genres = models.JSONField(default=list, blank=True)
    top_titles = models.JSONField(default=list, blank=True)
    tracearr_fetched_at = models.DateTimeField(null=True, blank=True)

    # Seerr
    seerr_user_id = models.IntegerField(null=True, blank=True)
    seerr_username = models.CharField(max_length=200, blank=True, default="")
    seerr_requests_total = models.IntegerField(default=0)
    seerr_requests_30d = models.IntegerField(default=0)
    seerr_last_request_at = models.DateTimeField(null=True, blank=True)
    seerr_fetched_at = models.DateTimeField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Usage for {self.subscriber}"


class ReminderLog(models.Model):
    subscriber = models.ForeignKey(Subscriber, on_delete=models.CASCADE, related_name="reminders")
    kind = models.CharField(max_length=40)
    due_date = models.DateField()
    sent_at = models.DateTimeField(auto_now_add=True)
    channels = models.CharField(max_length=200, blank=True, default="")
    message = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-sent_at"]
        constraints = [
            models.UniqueConstraint(fields=["subscriber", "kind", "due_date"], name="uniq_reminder_per_due_date"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} for {self.subscriber} (due {self.due_date})"


class AccessEvent(models.Model):
    """Audit trail of Jellyfin account enable/disable actions (automatic or manual)."""

    class Action(models.TextChoices):
        DISABLED = "disabled", "Disabled"
        ENABLED = "enabled", "Enabled"

    subscriber = models.ForeignKey(Subscriber, on_delete=models.CASCADE, related_name="access_events")
    action = models.CharField(max_length=10, choices=Action.choices)
    automatic = models.BooleanField(default=True)
    reason = models.CharField(max_length=300, blank=True, default="")
    sessions_stopped = models.IntegerField(default=0)
    devices_removed = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.subscriber} {self.action} ({'auto' if self.automatic else 'manual'})"


class SyncRun(models.Model):
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    ok = models.BooleanField(default=False)
    triggered_by = models.CharField(max_length=20, default="manual")
    result = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self) -> str:
        return f"Sync {self.started_at:%Y-%m-%d %H:%M}"
