from django.contrib import admin

from .models import AccessEvent, AppSettings, Payment, Plan, ReminderLog, Subscriber, SyncRun, UsageSnapshot

admin.site.site_header = "Tallyfin"
admin.site.site_title = "Tallyfin"
admin.site.index_title = "Administration"


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return not AppSettings.objects.exists()


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "price", "currency", "duration_value", "duration_unit", "is_active")


@admin.register(Subscriber)
class SubscriberAdmin(admin.ModelAdmin):
    list_display = ("name", "jellyfin_id", "plan", "next_payment_date", "status_override", "removed_from_jellyfin")
    search_fields = ("name", "jellyfin_id")
    list_filter = ("plan", "status_override", "removed_from_jellyfin")


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("subscriber", "amount", "currency", "paid_at", "period_start", "period_end", "method")
    list_filter = ("method",)


@admin.register(UsageSnapshot)
class UsageSnapshotAdmin(admin.ModelAdmin):
    list_display = ("subscriber", "plays_30d", "watch_ms_30d", "seerr_requests_30d", "updated_at")


@admin.register(ReminderLog)
class ReminderLogAdmin(admin.ModelAdmin):
    list_display = ("subscriber", "kind", "due_date", "sent_at", "channels")


@admin.register(AccessEvent)
class AccessEventAdmin(admin.ModelAdmin):
    list_display = ("subscriber", "action", "automatic", "reason", "created_at")
    list_filter = ("action", "automatic")


@admin.register(SyncRun)
class SyncRunAdmin(admin.ModelAdmin):
    list_display = ("started_at", "finished_at", "ok", "triggered_by")
