from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from .models import AccessEvent, AppSettings, Payment, Plan, ReminderLog, Subscriber, SyncRun, UsageSnapshot
from .services.notifications import configured_channels
from .services.status import compute_status

SECRET_MASK = "••••••••"
MS_PER_HOUR = 3_600_000


class PlanSerializer(serializers.ModelSerializer):
    monthly_price = serializers.SerializerMethodField()
    duration_label = serializers.CharField(read_only=True)
    subscriber_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Plan
        fields = [
            "id",
            "name",
            "description",
            "price",
            "currency",
            "duration_value",
            "duration_unit",
            "duration_label",
            "monthly_price",
            "is_active",
            "sort_order",
            "subscriber_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_monthly_price(self, plan: Plan) -> float:
        return float(plan.monthly_price())

    def validate_price(self, value: Decimal) -> Decimal:
        if value < 0:
            raise serializers.ValidationError("Price cannot be negative.")
        return value

    def validate_duration_value(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("Duration must be at least 1.")
        return value


class UsageSerializer(serializers.ModelSerializer):
    hours_7d = serializers.SerializerMethodField()
    hours_30d = serializers.SerializerMethodField()
    hours_all = serializers.SerializerMethodField()
    transcode_pct_30d = serializers.SerializerMethodField()

    class Meta:
        model = UsageSnapshot
        fields = [
            "tracearr_user_id",
            "tracearr_username",
            "plays_7d",
            "plays_30d",
            "plays_all",
            "watch_ms_7d",
            "watch_ms_30d",
            "watch_ms_all",
            "hours_7d",
            "hours_30d",
            "hours_all",
            "transcode_plays_30d",
            "transcode_pct_30d",
            "active_days_30d",
            "last_watched_at",
            "top_genres",
            "top_titles",
            "tracearr_fetched_at",
            "seerr_user_id",
            "seerr_username",
            "seerr_requests_total",
            "seerr_requests_30d",
            "seerr_last_request_at",
            "seerr_fetched_at",
        ]

    def get_hours_7d(self, usage: UsageSnapshot) -> float:
        return round(usage.watch_ms_7d / MS_PER_HOUR, 1)

    def get_hours_30d(self, usage: UsageSnapshot) -> float:
        return round(usage.watch_ms_30d / MS_PER_HOUR, 1)

    def get_hours_all(self, usage: UsageSnapshot) -> float:
        return round(usage.watch_ms_all / MS_PER_HOUR, 1)

    def get_transcode_pct_30d(self, usage: UsageSnapshot) -> float:
        if not usage.plays_30d:
            return 0.0
        return round(100.0 * usage.transcode_plays_30d / usage.plays_30d, 1)


class SubscriberSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)
    plan_id = serializers.PrimaryKeyRelatedField(
        source="plan", queryset=Plan.objects.all(), allow_null=True, required=False, write_only=True
    )
    usage = UsageSerializer(read_only=True)
    status = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()
    days_until_due = serializers.SerializerMethodField()
    monthly_revenue = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    is_paying = serializers.BooleanField(read_only=True)

    class Meta:
        model = Subscriber
        fields = [
            "id",
            "jellyfin_id",
            "name",
            "is_admin",
            "is_disabled",
            "is_hidden",
            "last_login_at",
            "last_activity_at",
            "removed_from_jellyfin",
            "avatar_url",
            "plan",
            "plan_id",
            "subscription_start",
            "next_payment_date",
            "status_override",
            "exempt_until",
            "access_disabled_by_app",
            "access_disabled_at",
            "email",
            "contact",
            "notes",
            "tracearr_user_id",
            "seerr_user_id",
            "usage",
            "status",
            "status_label",
            "days_until_due",
            "monthly_revenue",
            "is_paying",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "jellyfin_id",
            "name",
            "is_admin",
            "is_disabled",
            "is_hidden",
            "last_login_at",
            "last_activity_at",
            "removed_from_jellyfin",
            "access_disabled_by_app",
            "access_disabled_at",
            "created_at",
            "updated_at",
        ]

    def _status(self, sub: Subscriber):
        cache = self.context.setdefault("_status_cache", {})
        if sub.pk not in cache:
            cache[sub.pk] = compute_status(sub, self.context["settings"])
        return cache[sub.pk]

    def get_status(self, sub: Subscriber) -> str:
        return self._status(sub).status

    def get_status_label(self, sub: Subscriber) -> str:
        return self._status(sub).label

    def get_days_until_due(self, sub: Subscriber):
        return self._status(sub).days_until_due

    def get_monthly_revenue(self, sub: Subscriber) -> float:
        return float(self._status(sub).monthly_revenue)

    def get_avatar_url(self, sub: Subscriber):
        if not sub.primary_image_tag:
            return None
        return f"/api/subscribers/{sub.pk}/avatar/?tag={sub.primary_image_tag}"


class PaymentSerializer(serializers.ModelSerializer):
    subscriber_name = serializers.CharField(source="subscriber.name", read_only=True)
    plan_name = serializers.CharField(source="plan.name", read_only=True, default=None)

    class Meta:
        model = Payment
        fields = [
            "id",
            "subscriber",
            "subscriber_name",
            "plan",
            "plan_name",
            "amount",
            "currency",
            "paid_at",
            "period_start",
            "period_end",
            "method",
            "note",
            "created_at",
        ]
        read_only_fields = ["subscriber", "plan", "created_at"]


class RecordPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    currency = serializers.CharField(max_length=8, required=False, allow_blank=True)
    paid_at = serializers.DateField(required=False)
    period_start = serializers.DateField(required=False, allow_null=True)
    method = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    note = serializers.CharField(required=False, allow_blank=True, default="")
    advance_due_date = serializers.BooleanField(required=False, default=True)


class AppSettingsSerializer(serializers.ModelSerializer):
    reminder_time = serializers.TimeField(format="%H:%M", input_formats=["%H:%M", "%H:%M:%S"])
    jellyfin_configured = serializers.BooleanField(read_only=True)
    tracearr_configured = serializers.BooleanField(read_only=True)
    seerr_configured = serializers.BooleanField(read_only=True)
    notification_channels = serializers.SerializerMethodField()
    cost_breakdown = serializers.SerializerMethodField()

    class Meta:
        model = AppSettings
        exclude = ["id"]
        read_only_fields = ["last_sync_at", "last_reminder_run_date"]

    def get_notification_channels(self, s: AppSettings) -> list[str]:
        return configured_channels(s)

    def get_cost_breakdown(self, s: AppSettings) -> dict[str, float]:
        return s.monthly_cost_breakdown()

    def to_representation(self, instance: AppSettings):
        data = super().to_representation(instance)
        for field in AppSettings.SECRET_FIELDS:
            data[field] = SECRET_MASK if getattr(instance, field) else ""
        return data

    def update(self, instance: AppSettings, validated_data: dict):
        for field in AppSettings.SECRET_FIELDS:
            if field in validated_data and validated_data[field] == SECRET_MASK:
                validated_data.pop(field)
        return super().update(instance, validated_data)


class ReminderLogSerializer(serializers.ModelSerializer):
    subscriber_name = serializers.CharField(source="subscriber.name", read_only=True)

    class Meta:
        model = ReminderLog
        fields = ["id", "subscriber", "subscriber_name", "kind", "due_date", "sent_at", "channels"]


class AccessEventSerializer(serializers.ModelSerializer):
    subscriber_name = serializers.CharField(source="subscriber.name", read_only=True)

    class Meta:
        model = AccessEvent
        fields = ["id", "subscriber", "subscriber_name", "action", "automatic", "reason", "sessions_stopped", "devices_removed", "created_at"]


class SyncRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncRun
        fields = ["id", "started_at", "finished_at", "ok", "triggered_by", "result"]
