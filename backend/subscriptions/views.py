from __future__ import annotations

from collections import OrderedDict
from datetime import timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db.models import Count, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .integrations.http import IntegrationError
from .integrations.jellyfin import JellyfinClient
from .integrations.seerr import SeerrClient
from .integrations.tracearr import TracearrClient
from .models import AccessEvent, AppSettings, Payment, Plan, ReminderLog, Subscriber, SyncRun
from .serializers import (
    SECRET_MASK,
    AccessEventSerializer,
    AppSettingsSerializer,
    PaymentSerializer,
    PlanSerializer,
    RecordPaymentSerializer,
    ReminderLogSerializer,
    SubscriberSerializer,
    SyncRunSerializer,
)
from .services import enforcement
from .services import reminders as reminder_service
from .services.notifications import configured_channels, send_notification
from .services.profitability import compute_profitability
from .services.status import DUE_SOON, OVERDUE, compute_status
from .services.sync import is_sync_running, start_sync_in_background

User = get_user_model()


def _settings_context() -> dict:
    return {"settings": AppSettings.load()}


# ----------------------------------------------------------------------------- auth


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"ok": True})


class AuthStatusView(APIView):
    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response(
            {
                "setup_required": not User.objects.exists(),
                "authenticated": request.user.is_authenticated,
                "username": request.user.get_username() if request.user.is_authenticated else None,
            }
        )


class SetupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if User.objects.exists():
            return Response({"detail": "Setup already completed."}, status=http_status.HTTP_400_BAD_REQUEST)
        username = (request.data.get("username") or "admin").strip()
        password = request.data.get("password") or ""
        try:
            validate_password(password)
        except ValidationError as exc:
            return Response({"detail": " ".join(exc.messages)}, status=http_status.HTTP_400_BAD_REQUEST)
        user = User.objects.create_superuser(username=username, password=password)
        login(request, user)
        return Response({"ok": True, "username": user.get_username()})


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""
        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response({"detail": "Invalid username or password."}, status=http_status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response({"ok": True, "username": user.get_username()})


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        return Response({"ok": True})


class ChangePasswordView(APIView):
    def post(self, request):
        current = request.data.get("current_password") or ""
        new = request.data.get("new_password") or ""
        if not request.user.check_password(current):
            return Response({"detail": "Current password is incorrect."}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new, request.user)
        except ValidationError as exc:
            return Response({"detail": " ".join(exc.messages)}, status=http_status.HTTP_400_BAD_REQUEST)
        request.user.set_password(new)
        request.user.save()
        login(request, request.user)
        return Response({"ok": True})


# ----------------------------------------------------------------------------- settings


class SettingsView(APIView):
    def get(self, request):
        return Response(AppSettingsSerializer(AppSettings.load()).data)

    def put(self, request):
        serializer = AppSettingsSerializer(AppSettings.load(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TestConnectionView(APIView):
    """POST /api/settings/test/<service>/ with optional {url, api_key} overrides (unsaved values)."""

    def post(self, request, service: str):
        settings = AppSettings.load()
        url = (request.data.get("url") or "").strip()
        key = request.data.get("api_key") or ""
        if service == "jellyfin":
            url = url or settings.jellyfin_url
            key = settings.jellyfin_api_key if key in ("", SECRET_MASK) else key
            info = JellyfinClient(url, key).get_system_info()
            users = JellyfinClient(url, key).get_users()
            return Response(
                {"ok": True, "detail": f"Connected to {info.get('ServerName')} (Jellyfin {info.get('Version')}), {len(users)} users."}
            )
        if service == "tracearr":
            url = url or settings.tracearr_url
            key = settings.tracearr_api_key if key in ("", SECRET_MASK) else key
            data = TracearrClient(url, key).get_servers()
            servers = data.get("data") or []
            names = ", ".join(s.get("server_name", "?") for s in servers) or "no servers"
            return Response(
                {"ok": True, "detail": f"Connected to Tracearr {data.get('tracearr_version', '')} ({names})."}
            )
        if service == "seerr":
            url = url or settings.seerr_url
            key = settings.seerr_api_key if key in ("", SECRET_MASK) else key
            client = SeerrClient(url, key)
            status_info = client.get_status()
            main = client.get_main_settings()
            return Response(
                {
                    "ok": True,
                    "detail": f"Connected to {main.get('applicationTitle') or 'Seerr'} v{status_info.get('version', '?')}.",
                }
            )
        return Response({"detail": "Unknown service."}, status=http_status.HTTP_400_BAD_REQUEST)


class TestNotificationView(APIView):
    def post(self, request):
        settings = AppSettings.load()
        channels = configured_channels(settings)
        if not channels:
            return Response({"detail": "No notification channel is configured."}, status=http_status.HTTP_400_BAD_REQUEST)
        only = request.data.get("channels")
        results = send_notification(
            settings,
            "Tallyfin: test notification",
            "This is a test from Tallyfin. Reminders will arrive on this channel.",
            [],
            only=only if isinstance(only, list) else None,
        )
        ok = all(v == "ok" for v in results.values())
        return Response({"ok": ok, "results": results})


# ----------------------------------------------------------------------------- plans


class PlanViewSet(viewsets.ModelViewSet):
    serializer_class = PlanSerializer

    def get_queryset(self):
        return Plan.objects.annotate(
            subscriber_count=Count("subscribers", distinct=True), payment_count=Count("payments", distinct=True)
        ).order_by("sort_order", "price", "name")

    def destroy(self, request, *args, **kwargs):
        plan = self.get_object()
        if plan.subscriber_count:
            n = plan.subscriber_count
            return Response(
                {"detail": f"{n} subscriber{'s are' if n != 1 else ' is'} still on {plan.name}. Archive it instead, so they keep their plan."},
                status=http_status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


# ----------------------------------------------------------------------------- subscribers


def _subscriber_queryset(include_removed: bool = False):
    qs = Subscriber.objects.select_related("plan", "usage")
    if not include_removed:
        qs = qs.filter(removed_from_jellyfin=False)
    return qs


class SubscriberListView(APIView):
    def get(self, request):
        include_removed = request.query_params.get("include_removed") in ("1", "true")
        qs = _subscriber_queryset(include_removed).order_by("name")
        data = SubscriberSerializer(qs, many=True, context=_settings_context()).data
        return Response(data)


class SubscriberDetailView(APIView):
    def get(self, request, pk: int):
        sub = get_object_or_404(_subscriber_queryset(include_removed=True), pk=pk)
        context = _settings_context()
        data = SubscriberSerializer(sub, context=context).data
        data["payments"] = PaymentSerializer(sub.payments.select_related("plan").all(), many=True).data
        data["reminders"] = ReminderLogSerializer(sub.reminders.all()[:20], many=True).data
        data["access_events"] = AccessEventSerializer(sub.access_events.all()[:20], many=True).data
        return Response(data)

    def patch(self, request, pk: int):
        sub = get_object_or_404(_subscriber_queryset(include_removed=True), pk=pk)
        serializer = SubscriberSerializer(sub, data=request.data, partial=True, context=_settings_context())
        serializer.is_valid(raise_exception=True)
        sub = serializer.save()
        if sub.plan_id and not sub.next_payment_date:
            sub.next_payment_date = timezone.localdate()
        if sub.plan_id and not sub.subscription_start:
            sub.subscription_start = timezone.localdate()
        sub.save()
        return Response(SubscriberSerializer(sub, context=_settings_context()).data)


class RecordPaymentView(APIView):
    def post(self, request, pk: int):
        sub = get_object_or_404(_subscriber_queryset(include_removed=True), pk=pk)
        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        settings = AppSettings.load()
        plan = sub.plan
        today = timezone.localdate()

        amount = data.get("amount")
        if amount is None:
            if plan is None:
                return Response({"detail": "Amount is required when the subscriber has no plan."}, status=400)
            amount = plan.price
        currency = data.get("currency") or (plan.currency if plan else settings.currency)
        paid_at = data.get("paid_at") or today

        period_start = data.get("period_start")
        if period_start is None:
            current_due = sub.next_payment_date
            period_start = current_due if current_due and current_due >= today else today
        period_end = plan.add_duration(period_start) if plan else None

        payment = Payment.objects.create(
            subscriber=sub,
            plan=plan,
            amount=Decimal(amount),
            currency=currency,
            paid_at=paid_at,
            period_start=period_start,
            period_end=period_end,
            method=data.get("method") or "",
            note=data.get("note") or "",
        )
        if data.get("advance_due_date", True) and period_end:
            sub.next_payment_date = period_end
        if not sub.subscription_start:
            sub.subscription_start = period_start
        sub.save()

        # If Tallyfin had disabled their Jellyfin account, give access back right away.
        access_restored = False
        access_error = None
        try:
            access_restored = enforcement.restore_after_payment(sub, settings) is not None
        except IntegrationError as exc:
            access_error = exc.message
        return Response(
            {
                "payment": PaymentSerializer(payment).data,
                "subscriber": SubscriberSerializer(sub, context=_settings_context()).data,
                "access_restored": access_restored,
                "access_error": access_error,
            },
            status=http_status.HTTP_201_CREATED,
        )


class SubscriberActivityView(APIView):
    """Live recent activity (last plays from Tracearr, last requests from Seerr)."""

    def get(self, request, pk: int):
        sub = get_object_or_404(_subscriber_queryset(include_removed=True), pk=pk)
        settings = AppSettings.load()
        usage = getattr(sub, "usage", None)
        result = {
            "tracearr": {"ok": False, "history": [], "error": None, "kind": None, "detail": ""},
            "seerr": {"ok": False, "requests": [], "error": None, "kind": None, "detail": ""},
        }

        if settings.tracearr_configured and usage and usage.tracearr_user_id:
            try:
                client = TracearrClient(settings.tracearr_url, settings.tracearr_api_key)
                history = client.get_user_history(usage.tracearr_user_id, page_size=20)
                result["tracearr"] = {"ok": True, "error": None, "kind": None, "detail": "", "history": [_compact_play(h) for h in history]}
            except IntegrationError as exc:
                result["tracearr"].update(error=exc.message, kind=exc.kind, detail=exc.detail)
        elif not settings.tracearr_configured:
            result["tracearr"].update(error="Tracearr isn't set up yet.", kind="not_configured")
        else:
            result["tracearr"].update(error="No matching Tracearr user.", kind="no_match")

        if settings.seerr_configured and usage and usage.seerr_user_id:
            try:
                client = SeerrClient(settings.seerr_url, settings.seerr_api_key)
                page = client.get_user_requests(usage.seerr_user_id, take=15)
                requests_out = []
                for item in page.get("results") or []:
                    described = client.describe_request(item)
                    described["title"] = client.get_media_title(described["type"] or "movie", described["tmdb_id"])
                    requests_out.append(described)
                result["seerr"] = {"ok": True, "error": None, "kind": None, "detail": "", "requests": requests_out}
            except IntegrationError as exc:
                result["seerr"].update(error=exc.message, kind=exc.kind, detail=exc.detail)
        elif not settings.seerr_configured:
            result["seerr"].update(error="Seerr isn't set up yet.", kind="not_configured")
        else:
            result["seerr"].update(error="No matching Seerr user.", kind="no_match")
        return Response(result)


def _compact_play(item: dict) -> dict:
    show = item.get("show_title")
    title = item.get("media_title")
    if show:
        season = item.get("season_number")
        episode = item.get("episode_number")
        code = f"S{season:02d}E{episode:02d} " if season is not None and episode is not None else ""
        title = f"{show} — {code}{title}"
    return {
        "id": item.get("id"),
        "title": title,
        "media_type": item.get("media_type"),
        "year": item.get("year"),
        "started_at": item.get("started_at"),
        "stopped_at": item.get("stopped_at"),
        "duration_ms": item.get("duration_ms"),
        "percent_complete": item.get("percent_complete"),
        "watched": item.get("watched"),
        "player": item.get("player") or item.get("product"),
        "device": item.get("device"),
        "platform": item.get("platform"),
        "is_transcode": item.get("is_transcode"),
        "resolution": item.get("resolution"),
        "server_name": item.get("server_name"),
    }


class SubscriberAvatarView(APIView):
    def get(self, request, pk: int):
        sub = get_object_or_404(Subscriber, pk=pk)
        settings = AppSettings.load()
        if not settings.jellyfin_configured or not sub.primary_image_tag:
            return HttpResponse(status=404)
        try:
            content, content_type = JellyfinClient(settings.jellyfin_url, settings.jellyfin_api_key).get_user_image(
                sub.jellyfin_id
            )
        except IntegrationError:
            return HttpResponse(status=404)
        response = HttpResponse(content, content_type=content_type)
        response["Cache-Control"] = "private, max-age=3600"
        return response


class JellyfinAccessView(APIView):
    """Enable or disable the Jellyfin account (manual action, never automatic)."""

    def post(self, request, pk: int):
        sub = get_object_or_404(Subscriber, pk=pk)
        settings = AppSettings.load()
        if not settings.jellyfin_configured:
            return Response({"detail": "Jellyfin is not configured."}, status=400)
        disabled = bool(request.data.get("disabled"))
        client = JellyfinClient(settings.jellyfin_url, settings.jellyfin_api_key)
        if disabled:
            enforcement.disable_access(client, sub, "disabled manually", settings, automatic=False)
        else:
            enforcement.enable_access(client, sub, "enabled manually", automatic=False)
        return Response(SubscriberSerializer(sub, context=_settings_context()).data)


# ----------------------------------------------------------------------------- payments


class PaymentListView(APIView):
    def get(self, request):
        qs = Payment.objects.select_related("subscriber", "plan")
        subscriber = request.query_params.get("subscriber")
        if subscriber:
            qs = qs.filter(subscriber_id=subscriber)
        limit = int(request.query_params.get("limit") or 500)
        return Response(PaymentSerializer(qs[:limit], many=True).data)


class PaymentDetailView(APIView):
    def delete(self, request, pk: int):
        """Delete a payment. If it is the payment that set the current due date, the due date moves back
        to where it was before (the start of that payment's period)."""
        payment = get_object_or_404(Payment.objects.select_related("subscriber"), pk=pk)
        sub = payment.subscriber
        reverted = False
        if payment.period_start and payment.period_end and sub.next_payment_date == payment.period_end:
            sub.next_payment_date = payment.period_start
            sub.save(update_fields=["next_payment_date", "updated_at"])
            reverted = True
        payment.delete()
        return Response({"due_date_reverted": reverted, "next_payment_date": sub.next_payment_date})

    def patch(self, request, pk: int):
        payment = get_object_or_404(Payment, pk=pk)
        serializer = PaymentSerializer(payment, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# ----------------------------------------------------------------------------- dashboard / profitability


class DashboardView(APIView):
    def get(self, request):
        settings = AppSettings.load()
        today = timezone.localdate()
        context = {"settings": settings}

        counts = {"total": 0, "paying": 0, "active": 0, "due_soon": 0, "overdue": 0, "unassigned": 0, "exempt": 0, "paused": 0, "cancelled": 0, "expired": 0}
        mrr = Decimal("0")
        attention = []
        for sub in _subscriber_queryset().order_by("name"):
            st = compute_status(sub, settings, today)
            counts["total"] += 1
            counts[st.status] = counts.get(st.status, 0) + 1
            if sub.is_paying:
                counts["paying"] += 1
                mrr += st.monthly_revenue
            if st.needs_attention:
                attention.append(SubscriberSerializer(sub, context=context).data)
        attention.sort(key=lambda s: (s["days_until_due"] if s["days_until_due"] is not None else 0, s["name"].lower()))

        month_start = today.replace(day=1)
        collected_month = Payment.objects.filter(paid_at__gte=month_start).aggregate(total=Sum("amount"))["total"] or 0
        collected_30d = Payment.objects.filter(paid_at__gte=today - timedelta(days=30)).aggregate(total=Sum("amount"))["total"] or 0

        months: "OrderedDict[str, float]" = OrderedDict()
        cursor = (today - relativedelta(months=11)).replace(day=1)
        for _ in range(12):
            months[cursor.strftime("%Y-%m")] = 0.0
            cursor = cursor + relativedelta(months=1)
        for payment in Payment.objects.filter(paid_at__gte=(today - relativedelta(months=11)).replace(day=1)):
            key = payment.paid_at.strftime("%Y-%m")
            if key in months:
                months[key] += float(payment.amount)
        revenue_by_month = [{"month": key, "amount": round(value, 2)} for key, value in months.items()]

        now_playing = {"ok": False, "streams": [], "error": None, "kind": None, "detail": ""}
        if settings.jellyfin_configured:
            try:
                # Short timeout: the dashboard shouldn't hang for 20 s because the media server is down.
                streams = JellyfinClient(settings.jellyfin_url, settings.jellyfin_api_key, timeout=6).get_now_playing()
                now_playing = {"ok": True, "streams": streams, "error": None, "kind": None, "detail": ""}
            except IntegrationError as exc:
                now_playing.update(error=exc.message, kind=exc.kind, detail=exc.detail)
        else:
            now_playing.update(error="Jellyfin isn't set up yet.", kind="not_configured")

        last_run = SyncRun.objects.order_by("-started_at").first()
        return Response(
            {
                "currency": settings.currency,
                "counts": counts,
                "mrr": float(mrr),
                "collected_this_month": float(collected_month),
                "collected_last_30d": float(collected_30d),
                "revenue_by_month": revenue_by_month,
                "attention": attention,
                "upcoming": reminder_service.upcoming_items(settings, horizon_days=14),
                "recent_payments": PaymentSerializer(Payment.objects.select_related("subscriber", "plan")[:8], many=True).data,
                "now_playing": now_playing,
                "last_sync": SyncRunSerializer(last_run).data if last_run else None,
                "sync_running": is_sync_running(),
                "configured": {
                    "jellyfin": settings.jellyfin_configured,
                    "tracearr": settings.tracearr_configured,
                    "seerr": settings.seerr_configured,
                    "notifications": configured_channels(settings),
                },
            }
        )


class ProfitabilityView(APIView):
    def get(self, request):
        return Response(compute_profitability(AppSettings.load()))


# ----------------------------------------------------------------------------- sync / reminders


class SyncView(APIView):
    def get(self, request):
        settings = AppSettings.load()
        runs = SyncRun.objects.order_by("-started_at")[:10]
        return Response(
            {
                "running": is_sync_running(),
                "last_sync_at": settings.last_sync_at,
                "runs": SyncRunSerializer(runs, many=True).data,
            }
        )

    def post(self, request):
        settings = AppSettings.load()
        if not settings.jellyfin_configured:
            return Response({"detail": "Configure Jellyfin first."}, status=400)
        started = start_sync_in_background("manual")
        return Response({"started": started, "running": True})


class EnforcementView(APIView):
    """Access enforcement: what would be disabled/re-enabled now, recent events, and a manual run."""

    def get(self, request):
        settings = AppSettings.load()
        pending_disable, pending_enable = ([], []) if not settings.jellyfin_configured else enforcement.plan_actions(settings)
        return Response(
            {
                "enabled": settings.auto_disable_enabled,
                "after_days": settings.auto_disable_after_days,
                "grace_days": settings.grace_days,
                "reenable_on_payment": settings.auto_reenable_on_payment,
                "disable_message": settings.disable_message,
                "jellyfin_configured": settings.jellyfin_configured,
                "pending_disable": [{"subscriber_id": s.pk, "name": s.name, "reason": r} for s, r in pending_disable],
                "pending_enable": [{"subscriber_id": s.pk, "name": s.name, "reason": r} for s, r in pending_enable],
                "events": AccessEventSerializer(AccessEvent.objects.select_related("subscriber")[:50], many=True).data,
            }
        )

    def post(self, request):
        dry_run = bool(request.data.get("dry_run"))
        raw_ids = request.data.get("subscriber_ids")
        only_ids = None
        if raw_ids is not None:
            if not isinstance(raw_ids, list):
                return Response({"detail": "subscriber_ids must be a list."}, status=400)
            only_ids = {int(i) for i in raw_ids if str(i).isdigit()}
        return Response(enforcement.run_enforcement(dry_run=dry_run, force=True, only_ids=only_ids))


class RemindersView(APIView):
    def get(self, request):
        settings = AppSettings.load()
        return Response(
            {
                "enabled": settings.reminders_enabled,
                "channels": configured_channels(settings),
                "reminder_time": settings.reminder_time.strftime("%H:%M"),
                "days_before": settings.reminder_days_list(),
                "overdue_every_days": settings.reminder_overdue_every_days,
                "last_run_date": settings.last_reminder_run_date,
                "upcoming": reminder_service.upcoming_items(settings, horizon_days=30),
                "pending": reminder_service.pending_reminders(settings),
                "log": ReminderLogSerializer(ReminderLog.objects.select_related("subscriber")[:50], many=True).data,
            }
        )

    def post(self, request):
        dry_run = bool(request.data.get("dry_run"))
        result = reminder_service.run_reminders(force=True, dry_run=dry_run)
        return Response(result)
