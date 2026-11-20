from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import AccessEvent, AppSettings, Payment, Plan, ReminderLog, Subscriber, UsageSnapshot
from .services import reminders as reminder_service
from .services.profitability import compute_profitability
from .services.enforcement import run_enforcement
from .services.status import ACTIVE, DUE_SOON, EXEMPT, EXPIRED, OVERDUE, UNASSIGNED, compute_status
from .services.sync import run_sync

User = get_user_model()


def make_plan(name="Monthly", price="10.00", value=1, unit="month"):
    return Plan.objects.create(name=name, price=Decimal(price), currency="USD", duration_value=value, duration_unit=unit)


def make_sub(name="alice", jellyfin_id=None, **kwargs):
    return Subscriber.objects.create(jellyfin_id=jellyfin_id or f"id-{name}", name=name, **kwargs)


class AuthFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_setup_then_login(self):
        status = self.client.get("/api/auth/status/").json()
        self.assertTrue(status["setup_required"])
        self.assertFalse(status["authenticated"])

        # Protected endpoints are refused before login.
        self.assertIn(self.client.get("/api/subscribers/").status_code, (401, 403))

        res = self.client.post("/api/auth/setup/", {"username": "admin", "password": "correct-horse-battery"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(self.client.get("/api/auth/status/").json()["authenticated"])

        # Setup cannot run twice.
        res = self.client.post("/api/auth/setup/", {"username": "x", "password": "another-password-1"}, format="json")
        self.assertEqual(res.status_code, 400)

        self.client.post("/api/auth/logout/")
        self.assertFalse(self.client.get("/api/auth/status/").json()["authenticated"])
        res = self.client.post("/api/auth/login/", {"username": "admin", "password": "wrong"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/api/auth/login/", {"username": "admin", "password": "correct-horse-battery"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.get("/api/subscribers/").status_code, 200)


class AuthenticatedTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser("admin", password="correct-horse-battery")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.settings_row = AppSettings.load()


class PlanAndPaymentTests(AuthenticatedTestCase):
    def test_plan_crud_and_monthly_price(self):
        res = self.client.post(
            "/api/plans/",
            {"name": "Yearly", "price": "96.00", "currency": "USD", "duration_value": 1, "duration_unit": "year"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        plan = res.json()
        self.assertEqual(plan["monthly_price"], 8.0)
        self.assertEqual(plan["duration_label"], "year")

        res = self.client.patch(f"/api/plans/{plan['id']}/", {"price": "120.00"}, format="json")
        self.assertEqual(res.json()["monthly_price"], 10.0)
        self.assertEqual(self.client.get("/api/plans/").json()[0]["subscriber_count"], 0)

    def test_assign_plan_defaults_due_date_and_record_payment(self):
        plan = make_plan()
        sub = make_sub()
        today = timezone.localdate()

        res = self.client.patch(f"/api/subscribers/{sub.pk}/", {"plan_id": plan.pk}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["next_payment_date"], today.isoformat())
        self.assertEqual(body["status"], DUE_SOON)
        self.assertEqual(body["monthly_revenue"], 10.0)

        res = self.client.post(f"/api/subscribers/{sub.pk}/payments/", {"method": "e-transfer"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        payment = res.json()["payment"]
        self.assertEqual(Decimal(str(payment["amount"])), Decimal("10.00"))
        self.assertEqual(payment["period_start"], today.isoformat())
        expected_end = plan.add_duration(today)
        self.assertEqual(payment["period_end"], expected_end.isoformat())
        sub.refresh_from_db()
        self.assertEqual(sub.next_payment_date, expected_end)
        self.assertEqual(sub.subscription_start, today)

        # Paying early extends from the current due date, not from today.
        res = self.client.post(f"/api/subscribers/{sub.pk}/payments/", {}, format="json")
        self.assertEqual(res.json()["payment"]["period_start"], expected_end.isoformat())
        sub.refresh_from_db()
        self.assertEqual(sub.next_payment_date, plan.add_duration(expected_end))
        self.assertEqual(Payment.objects.count(), 2)

        ledger = self.client.get("/api/payments/").json()
        self.assertEqual(len(ledger), 2)
        self.assertEqual(ledger[0]["subscriber_name"], "alice")


class StatusTests(TestCase):
    def test_status_rules(self):
        settings = AppSettings.load()
        settings.due_soon_days = 7
        settings.grace_days = 2
        plan = make_plan()
        today = timezone.localdate()

        unassigned = make_sub("u")
        self.assertEqual(compute_status(unassigned, settings).status, UNASSIGNED)

        active = make_sub("a", plan=plan, next_payment_date=today + timedelta(days=20))
        self.assertEqual(compute_status(active, settings).status, ACTIVE)

        soon = make_sub("s", plan=plan, next_payment_date=today + timedelta(days=5))
        st = compute_status(soon, settings)
        self.assertEqual(st.status, DUE_SOON)
        self.assertEqual(st.days_until_due, 5)

        in_grace = make_sub("g", plan=plan, next_payment_date=today - timedelta(days=2))
        self.assertEqual(compute_status(in_grace, settings).status, DUE_SOON)

        overdue = make_sub("o", plan=plan, next_payment_date=today - timedelta(days=3))
        self.assertEqual(compute_status(overdue, settings).status, OVERDUE)

        exempt = make_sub("e", plan=plan, next_payment_date=today - timedelta(days=30), status_override="exempt")
        self.assertEqual(compute_status(exempt, settings).status, "exempt")


class ReminderTests(TestCase):
    def setUp(self):
        self.settings = AppSettings.load()
        self.settings.reminder_days_before = "7,3,1"
        self.settings.reminder_overdue_every_days = 3
        self.settings.grace_days = 0
        self.settings.discord_webhook_url = "https://discord.example/webhook"
        self.settings.save()
        self.plan = make_plan()
        today = timezone.localdate()
        self.due_in_3 = make_sub("three", plan=self.plan, next_payment_date=today + timedelta(days=3))
        self.due_in_5 = make_sub("five", plan=self.plan, next_payment_date=today + timedelta(days=5))
        self.due_today = make_sub("today", plan=self.plan, next_payment_date=today)
        self.overdue_1 = make_sub("late1", plan=self.plan, next_payment_date=today - timedelta(days=1))
        self.overdue_2 = make_sub("late2", plan=self.plan, next_payment_date=today - timedelta(days=2))
        self.overdue_6 = make_sub("late6", plan=self.plan, next_payment_date=today - timedelta(days=6))
        self.exempt = make_sub("free", plan=self.plan, next_payment_date=today, status_override="exempt")

    def test_pending_kinds(self):
        pending = {item["name"]: item["kind"] for item in reminder_service.pending_reminders(self.settings)}
        self.assertEqual(
            pending,
            {"three": "due_in_3", "today": "due_today", "late1": "overdue_1", "late6": "overdue_6"},
        )

    @mock.patch("subscriptions.services.reminders.send_notification", return_value={"discord": "ok"})
    def test_run_reminders_sends_digest_once(self, send):
        result = reminder_service.run_reminders(force=True)
        self.assertEqual(result["sent"], 4)
        send.assert_called_once()
        title, message = send.call_args.args[1], send.call_args.args[2]
        self.assertIn("2 overdue", title)
        self.assertIn("1 due today", title)
        self.assertIn("1 due soon", title)
        self.assertIn("late6", message)
        self.assertEqual(ReminderLog.objects.count(), 4)

        # Same day again: nothing new to send.
        result = reminder_service.run_reminders(force=True)
        self.assertEqual(result["sent"], 0)
        self.assertEqual(send.call_count, 1)

    @mock.patch("subscriptions.services.reminders.send_notification", return_value={"discord": "boom"})
    def test_failed_delivery_is_not_logged(self, send):
        result = reminder_service.run_reminders(force=True)
        self.assertEqual(result["sent"], 0)
        self.assertEqual(ReminderLog.objects.count(), 0)

    def test_upcoming_items_sorted(self):
        names = [item["name"] for item in reminder_service.upcoming_items(self.settings, horizon_days=14)]
        self.assertEqual(names, ["late6", "late2", "late1", "today", "three", "five"])


class ProfitabilityTests(AuthenticatedTestCase):
    def test_ranking_by_revenue_per_hour(self):
        plan = make_plan(price="12.00")
        today = timezone.localdate()
        heavy = make_sub("heavy", plan=plan, next_payment_date=today + timedelta(days=10))
        light = make_sub("light", plan=plan, next_payment_date=today + timedelta(days=10))
        idle = make_sub("idle", plan=plan, next_payment_date=today + timedelta(days=10))
        free = make_sub("free", status_override="exempt")
        UsageSnapshot.objects.create(subscriber=heavy, tracearr_user_id="t1", watch_ms_30d=60 * 3_600_000, plays_30d=40, transcode_plays_30d=10)
        UsageSnapshot.objects.create(subscriber=light, tracearr_user_id="t2", watch_ms_30d=6 * 3_600_000, plays_30d=4)
        UsageSnapshot.objects.create(subscriber=free, tracearr_user_id="t3", watch_ms_30d=30 * 3_600_000, plays_30d=20)
        Payment.objects.create(subscriber=heavy, plan=plan, amount=Decimal("12.00"), currency="USD", paid_at=today)

        data = self.client.get("/api/profitability/").json()
        rows = {row["name"]: row for row in data["rows"]}
        self.assertIsNone(rows["idle"]["revenue_per_hour"])
        self.assertEqual(rows["heavy"]["revenue_per_hour"], 0.2)
        self.assertEqual(rows["light"]["revenue_per_hour"], 2.0)
        self.assertEqual(rows["heavy"]["transcode_pct"], 25.0)
        self.assertEqual(rows["heavy"]["paid_last_12m"], 12.0)
        self.assertEqual(rows["free"]["monthly_revenue"], 0.0)
        order = [row["name"] for row in data["rows"]]
        self.assertEqual(order[:3], ["idle", "light", "heavy"])
        self.assertEqual(data["totals"]["mrr"], 36.0)
        self.assertEqual(data["totals"]["free_hours_30d"], 30.0)

        # With a server cost, margin allocates cost by watch-time share.
        self.settings_row.monthly_server_cost = Decimal("96.00")
        self.settings_row.save()
        data = compute_profitability(AppSettings.load())
        rows = {row["name"]: row for row in data["rows"]}
        self.assertEqual(rows["heavy"]["allocated_cost"], 60.0)
        self.assertEqual(rows["heavy"]["margin"], -48.0)
        self.assertEqual(rows["light"]["margin"], 6.0)
        self.assertEqual(data["rows"][0]["name"], "idle")


class RunningCostTests(AuthenticatedTestCase):
    def test_electricity_cost_breakdown_feeds_profitability(self):
        s = self.settings_row
        s.server_watts = 120
        s.server_hours_per_day = Decimal("24")
        s.electricity_price_per_kwh = Decimal("0.15")
        s.monthly_server_cost = Decimal("4.00")
        s.save()
        # 0.12 kW × 24 h × 30.4375 days = 87.66 kWh → × 0.15 = 13.15, plus 4.00 other = 17.15
        breakdown = AppSettings.load().monthly_cost_breakdown()
        self.assertEqual(breakdown, {"kwh_per_month": 87.7, "electricity_cost": 13.15, "other_costs": 4.0, "total": 17.15})

        self.assertEqual(self.client.get("/api/settings/").json()["cost_breakdown"]["total"], 17.15)
        data = self.client.get("/api/profitability/").json()
        self.assertEqual(data["monthly_server_cost"], 17.15)
        self.assertEqual(data["cost_breakdown"]["kwh_per_month"], 87.7)

        # Half the day on, no other costs: electricity halves.
        res = self.client.put("/api/settings/", {"server_hours_per_day": "12", "monthly_server_cost": 0}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["cost_breakdown"]["total"], 6.57)


class DashboardTests(AuthenticatedTestCase):
    def test_dashboard_without_integrations(self):
        plan = make_plan()
        today = timezone.localdate()
        make_sub("a", plan=plan, next_payment_date=today - timedelta(days=3))
        make_sub("b", plan=plan, next_payment_date=today + timedelta(days=40))
        Payment.objects.create(subscriber=Subscriber.objects.get(name="b"), plan=plan, amount=Decimal("10"), currency="USD", paid_at=today)
        data = self.client.get("/api/dashboard/").json()
        self.assertEqual(data["counts"]["overdue"], 1)
        self.assertEqual(data["counts"]["active"], 1)
        self.assertEqual(data["mrr"], 20.0)
        self.assertEqual(data["collected_this_month"], 10.0)
        self.assertEqual(len(data["revenue_by_month"]), 12)
        self.assertEqual(data["revenue_by_month"][-1]["amount"], 10.0)
        self.assertEqual(len(data["attention"]), 1)
        self.assertFalse(data["now_playing"]["ok"])
        self.assertFalse(data["configured"]["jellyfin"])


JELLYFIN_USERS = [
    {"Id": "AABB-CCDD", "Name": "Alice", "LastLoginDate": "2026-10-20T14:03:22.1234567Z", "PrimaryImageTag": "tag1", "Policy": {"IsAdministrator": False, "IsDisabled": False}},
    {"Id": "EEFF0011", "Name": "Bob", "Policy": {"IsAdministrator": True}},
    {"Id": "22334455", "Name": "Carol", "Policy": {}},
]

TRACEARR_USERS = [
    {"id": "t-alice", "username": "alice-identity", "accounts": [{"server_type": "jellyfin", "external_user_id": "aabbccdd", "username": "Alice"}]},
    {"id": "t-bob", "username": "bob", "accounts": [{"server_type": "jellyfin", "external_user_id": "zzz", "username": "Bob"}]},
]

TRACEARR_STATS = {
    "t-alice": {"windows": {"all_time": {"plays": 100, "watch_time_ms": 360_000_000}, "last_30": {"plays": 10, "watch_time_ms": 36_000_000}, "last_7": {"plays": 2, "watch_time_ms": 7_200_000}}, "top_genres": [{"genre": "Drama", "plays": 5}]},
    "t-bob": {"windows": {"all_time": {"plays": 1, "watch_time_ms": 1000}, "last_30": {"plays": 0, "watch_time_ms": 0}, "last_7": {"plays": 0, "watch_time_ms": 0}}, "top_genres": []},
}

TRACEARR_HISTORY = [
    {"user": {"id": "t-alice"}, "duration_ms": 3_600_000, "is_transcode": True, "started_at": "2026-10-21T20:00:00Z", "show_title": "Show A", "media_title": "Ep 1"},
    {"user": {"id": "t-alice"}, "duration_ms": 1_800_000, "is_transcode": False, "started_at": "2026-10-22T20:00:00Z", "show_title": "Show A", "media_title": "Ep 2"},
]

SEERR_USERS = [
    {"id": 1, "displayName": "Alice", "jellyfinUserId": "AABBCCDD", "requestCount": 7},
    {"id": 2, "displayName": "Bob", "jellyfinUsername": "bob", "requestCount": 2},
]


class SyncTests(TestCase):
    def setUp(self):
        s = AppSettings.load()
        s.jellyfin_url = "http://jellyfin"
        s.jellyfin_api_key = "k"
        s.tracearr_url = "http://tracearr"
        s.tracearr_api_key = "k"
        s.seerr_url = "http://seerr"
        s.seerr_api_key = "k"
        s.save()

    @mock.patch("subscriptions.services.sync.SeerrClient")
    @mock.patch("subscriptions.services.sync.TracearrClient")
    @mock.patch("subscriptions.services.sync.JellyfinClient")
    def test_full_sync_matches_users_across_services(self, jellyfin_cls, tracearr_cls, seerr_cls):
        jellyfin_cls.return_value.get_users.return_value = JELLYFIN_USERS
        tracearr = tracearr_cls.return_value
        tracearr.list_users.return_value = TRACEARR_USERS
        tracearr.get_user_stats.side_effect = lambda uid: TRACEARR_STATS[uid]
        tracearr.get_history.return_value = TRACEARR_HISTORY
        tracearr.get_user_history.return_value = [{"started_at": "2026-01-01T00:00:00Z"}]
        seerr = seerr_cls.return_value
        seerr.list_users.return_value = SEERR_USERS
        now = timezone.now()
        seerr.iter_user_requests.side_effect = lambda uid, max_pages=4: iter(
            [{"createdAt": (now - timedelta(days=2)).isoformat()}, {"createdAt": (now - timedelta(days=90)).isoformat()}]
        )

        # A stale subscriber that no longer exists in Jellyfin gets flagged.
        make_sub("ghost", jellyfin_id="gone")

        run = run_sync("test")
        self.assertTrue(run.ok, run.result)
        self.assertEqual(run.result["jellyfin"]["users"], 3)
        self.assertEqual(run.result["jellyfin"]["removed"], 1)
        self.assertEqual(run.result["tracearr"]["matched"], 2)
        self.assertEqual(run.result["seerr"]["matched"], 2)

        alice = Subscriber.objects.get(jellyfin_id="AABB-CCDD")
        self.assertEqual(alice.name, "Alice")
        self.assertIsNotNone(alice.last_login_at)
        self.assertTrue(Subscriber.objects.get(jellyfin_id="gone").removed_from_jellyfin)
        self.assertTrue(Subscriber.objects.get(name="Bob").is_admin)

        usage = alice.usage
        self.assertEqual(usage.tracearr_user_id, "t-alice")  # matched on external id (dash-insensitive)
        self.assertEqual(usage.plays_30d, 10)
        self.assertEqual(usage.watch_ms_30d, 36_000_000)
        self.assertEqual(usage.transcode_plays_30d, 1)
        self.assertEqual(usage.active_days_30d, 2)
        self.assertEqual(usage.top_titles[0], {"title": "Show A", "plays": 2})
        self.assertEqual(usage.top_genres[0]["genre"], "Drama")
        self.assertEqual(usage.last_watched_at.isoformat(), "2026-10-22T20:00:00+00:00")
        self.assertEqual(usage.seerr_user_id, 1)
        self.assertEqual(usage.seerr_requests_total, 7)
        self.assertEqual(usage.seerr_requests_30d, 1)

        bob_usage = Subscriber.objects.get(name="Bob").usage
        self.assertEqual(bob_usage.tracearr_user_id, "t-bob")  # matched on username fallback
        self.assertEqual(bob_usage.last_watched_at.year, 2026)  # fetched from per-user history
        self.assertEqual(bob_usage.seerr_user_id, 2)

        carol_usage = Subscriber.objects.get(name="Carol").usage
        self.assertEqual(carol_usage.tracearr_user_id, "")
        self.assertIsNone(carol_usage.seerr_user_id)

    @mock.patch("subscriptions.services.sync.TracearrClient")
    @mock.patch("subscriptions.services.sync.JellyfinClient")
    def test_partial_failure_is_reported(self, jellyfin_cls, tracearr_cls):
        from subscriptions.integrations.http import IntegrationError

        jellyfin_cls.return_value.get_users.return_value = JELLYFIN_USERS
        tracearr_cls.return_value.list_users.side_effect = IntegrationError("Tracearr", "authentication failed")
        s = AppSettings.load()
        s.seerr_url = ""
        s.save()
        run = run_sync("test")
        self.assertFalse(run.ok)
        self.assertTrue(run.result["jellyfin"]["ok"])
        self.assertFalse(run.result["tracearr"]["ok"])
        self.assertIn("authentication failed", run.result["tracearr"]["error"])
        self.assertTrue(run.result["seerr"]["skipped"])
        self.assertEqual(Subscriber.objects.count(), 3)


class SettingsApiTests(AuthenticatedTestCase):
    def test_secrets_are_masked_and_preserved(self):
        res = self.client.put("/api/settings/", {"jellyfin_url": "http://jf", "jellyfin_api_key": "secret-key", "reminder_time": "08:30"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["jellyfin_api_key"], "••••••••")
        self.assertTrue(res.json()["jellyfin_configured"])
        self.assertEqual(res.json()["reminder_time"], "08:30")

        # Sending the mask back keeps the stored secret.
        res = self.client.put("/api/settings/", {"jellyfin_api_key": "••••••••", "currency": "CAD"}, format="json")
        self.assertEqual(AppSettings.load().jellyfin_api_key, "secret-key")
        self.assertEqual(AppSettings.load().currency, "CAD")

        # Blank clears it.
        self.client.put("/api/settings/", {"jellyfin_api_key": ""}, format="json")
        self.assertEqual(AppSettings.load().jellyfin_api_key, "")


class EnforcementTests(AuthenticatedTestCase):
    def setUp(self):
        super().setUp()
        s = self.settings_row
        s.jellyfin_url = "http://jellyfin"
        s.jellyfin_api_key = "k"
        s.grace_days = 2
        s.auto_disable_after_days = 0
        s.save()
        self.plan = make_plan()
        today = timezone.localdate()
        self.late = make_sub("late", plan=self.plan, next_payment_date=today - timedelta(days=5))
        self.in_grace = make_sub("grace", plan=self.plan, next_payment_date=today - timedelta(days=1))
        self.active = make_sub("active", plan=self.plan, next_payment_date=today + timedelta(days=20))
        self.admin_late = make_sub("adminlate", plan=self.plan, next_payment_date=today - timedelta(days=30), is_admin=True)
        self.manual = make_sub("manual", plan=self.plan, next_payment_date=today + timedelta(days=10), is_disabled=True, access_disabled_by_app=False)
        self.paid_back = make_sub("paidback", plan=self.plan, next_payment_date=today + timedelta(days=10), is_disabled=True, access_disabled_by_app=True)
        self.trial = make_sub("trial", status_override="exempt", exempt_until=today - timedelta(days=1))
        self.trial_ok = make_sub("trialok", status_override="exempt", exempt_until=today + timedelta(days=5))
        self.free = make_sub("free", status_override="exempt")

    def test_exemption_statuses(self):
        self.assertEqual(compute_status(self.trial, self.settings_row).status, EXPIRED)
        st = compute_status(self.trial_ok, self.settings_row)
        self.assertEqual((st.status, st.days_until_due), (EXEMPT, 5))
        self.assertEqual(compute_status(self.free, self.settings_row).status, EXEMPT)

    @mock.patch("subscriptions.services.enforcement.JellyfinClient")
    def test_run_enforcement_disables_and_restores(self, client_cls):
        client = client_cls.return_value
        client.logout_user_everywhere.return_value = {"sessions_stopped": 1, "devices_removed": 2}

        result = run_enforcement()
        self.assertEqual({d["name"] for d in result["disabled"]}, {"late", "trial"})
        self.assertEqual({e["name"] for e in result["enabled"]}, {"paidback"})
        self.assertEqual(result["errors"], [])
        client.set_user_disabled.assert_any_call("id-late", True)
        client.set_user_disabled.assert_any_call("id-trial", True)
        client.set_user_disabled.assert_any_call("id-paidback", False)
        client.logout_user_everywhere.assert_any_call("id-late", message=self.settings_row.disable_message)

        self.late.refresh_from_db()
        self.assertTrue(self.late.is_disabled)
        self.assertTrue(self.late.access_disabled_by_app)
        self.assertIsNotNone(self.late.access_disabled_at)
        self.paid_back.refresh_from_db()
        self.assertFalse(self.paid_back.is_disabled)
        self.assertFalse(self.paid_back.access_disabled_by_app)
        for untouched in (self.in_grace, self.active, self.admin_late, self.trial_ok, self.free):
            untouched.refresh_from_db()
            self.assertFalse(untouched.is_disabled, untouched.name)
        self.manual.refresh_from_db()
        self.assertTrue(self.manual.is_disabled)

        events = AccessEvent.objects.filter(subscriber=self.late)
        self.assertEqual(events.count(), 1)
        self.assertEqual((events[0].action, events[0].automatic, events[0].devices_removed), ("disabled", True, 2))
        self.assertIn("5 days overdue", events[0].reason)
        self.assertIn("exemption ended", AccessEvent.objects.get(subscriber=self.trial).reason)

        # Idempotent: a second run changes nothing.
        result = run_enforcement()
        self.assertEqual((result["disabled"], result["enabled"]), ([], []))
        self.assertEqual(AccessEvent.objects.count(), 3)

    @mock.patch("subscriptions.services.enforcement.JellyfinClient")
    def test_dry_run_and_settings(self, client_cls):
        result = run_enforcement(dry_run=True)
        self.assertEqual({d["name"] for d in result["disabled"]}, {"late", "trial"})
        client_cls.return_value.set_user_disabled.assert_not_called()
        self.assertEqual(AccessEvent.objects.count(), 0)

        self.settings_row.auto_disable_enabled = False
        self.settings_row.save()
        self.assertIn("skipped", run_enforcement())
        self.assertNotIn("skipped", run_enforcement(force=True, dry_run=True))

        self.settings_row.auto_disable_enabled = True
        self.settings_row.auto_disable_after_days = 10  # 5 days overdue, 3 beyond grace: not yet
        self.settings_row.save()
        result = run_enforcement(dry_run=True)
        self.assertEqual({d["name"] for d in result["disabled"]}, {"trial"})

    @mock.patch("subscriptions.services.enforcement.JellyfinClient")
    def test_payment_restores_access(self, client_cls):
        today = timezone.localdate()
        self.late.is_disabled = True
        self.late.access_disabled_by_app = True
        self.late.save()
        res = self.client.post(f"/api/subscribers/{self.late.pk}/payments/", {"period_start": today.isoformat()}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["access_restored"])
        client_cls.return_value.set_user_disabled.assert_called_once_with("id-late", False)
        self.late.refresh_from_db()
        self.assertFalse(self.late.is_disabled)
        self.assertEqual(AccessEvent.objects.get(subscriber=self.late).reason, "payment recorded")

        # A manually disabled account is not touched by a payment.
        res = self.client.post(f"/api/subscribers/{self.manual.pk}/payments/", {}, format="json")
        self.assertFalse(res.json()["access_restored"])
        self.manual.refresh_from_db()
        self.assertTrue(self.manual.is_disabled)

    @mock.patch("subscriptions.views.JellyfinClient")
    def test_manual_toggle_is_not_auto_reverted(self, client_cls):
        res = self.client.post(f"/api/subscribers/{self.active.pk}/jellyfin-access/", {"disabled": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.active.refresh_from_db()
        self.assertTrue(self.active.is_disabled)
        self.assertFalse(self.active.access_disabled_by_app)
        with mock.patch("subscriptions.services.enforcement.JellyfinClient"):
            result = run_enforcement()
        self.assertNotIn("active", {e["name"] for e in result["enabled"]})

    @mock.patch("subscriptions.services.enforcement.JellyfinClient")
    def test_manual_run_only_touches_confirmed_subscribers(self, client_cls):
        client_cls.return_value.logout_user_everywhere.return_value = {"sessions_stopped": 0, "devices_removed": 0}
        # The admin confirmed only "late"; "trial" became due meanwhile and must be left alone.
        res = self.client.post("/api/enforcement/", {"dry_run": False, "subscriber_ids": [self.late.pk]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([d["name"] for d in res.json()["disabled"]], ["late"])
        self.assertEqual(res.json()["enabled"], [])
        client_cls.return_value.set_user_disabled.assert_called_once_with("id-late", True)

    def test_enforcement_endpoint(self):
        data = self.client.get("/api/enforcement/").json()
        self.assertEqual(data["disable_message"], self.settings_row.disable_message)
        self.assertTrue(data["enabled"])
        self.assertEqual({d["name"] for d in data["pending_disable"]}, {"late", "trial"})
        self.assertEqual({d["name"] for d in data["pending_enable"]}, {"paidback"})


class JellyfinLogoutTests(TestCase):
    def test_logout_user_everywhere_stops_playback_and_removes_devices(self):
        from subscriptions.integrations.jellyfin import JellyfinClient

        client = JellyfinClient("http://jellyfin", "k")
        calls = []

        def fake_request(method, path, **kwargs):
            calls.append((method, path, kwargs.get("params"), kwargs.get("json")))
            if path == "/Sessions":
                return [
                    {"Id": "s1", "UserId": "AABB-CCDD", "NowPlayingItem": {"Name": "x"}},
                    {"Id": "s2", "UserId": "aabbccdd"},
                    {"Id": "s3", "UserId": "other", "AdditionalUsers": [{"UserId": "AABBCCDD"}]},
                    {"Id": "s4", "UserId": "someone-else"},
                ]
            if path == "/Devices" and method == "GET":
                return {"Items": [{"Id": "d1"}, {"Id": "d2"}]}
            return None

        with mock.patch.object(client, "request", side_effect=fake_request):
            counts = client.logout_user_everywhere("AABBCCDD", message="bye")
        self.assertEqual(counts, {"sessions_stopped": 1, "devices_removed": 2})
        messaged = [c[1] for c in calls if c[1].endswith("/Message")]
        self.assertEqual(messaged, ["/Sessions/s1/Message", "/Sessions/s2/Message", "/Sessions/s3/Message"])
        self.assertIn(("POST", "/Sessions/s1/Playing/Stop", None, None), calls)
        self.assertIn(("DELETE", "/Devices", {"id": "d1"}, None), calls)
        self.assertIn(("DELETE", "/Devices", {"id": "d2"}, None), calls)


class ProxyCsrfTests(TestCase):
    """Behind an HTTPS proxy (Cloudflare Tunnel, Traefik...) the forwarded scheme must satisfy CSRF origin checks."""

    def setUp(self):
        self.user = User.objects.create_superuser("admin", password="correct-horse-battery")

    def _client(self):
        from django.test import Client

        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        client.get("/api/auth/status/")  # sets the csrftoken cookie
        return client, client.cookies["csrftoken"].value

    def _put_settings(self, client, token, **headers):
        return client.put(
            "/api/settings/",
            data='{"currency": "CAD"}',
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
            HTTP_HOST="tallyfin.example.com",
            HTTP_ORIGIN="https://tallyfin.example.com",
            **headers,
        )

    def test_https_origin_behind_proxy_is_accepted(self):
        client, token = self._client()
        res = self._put_settings(client, token, HTTP_X_FORWARDED_PROTO="https")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(AppSettings.load().currency, "CAD")

    def test_https_origin_without_forwarded_proto_is_rejected(self):
        client, token = self._client()
        res = self._put_settings(client, token)
        self.assertEqual(res.status_code, 403, res.content)
        self.assertIn("Origin checking failed", res.json()["detail"])


class ErrorPresentationTests(AuthenticatedTestCase):
    """Failures reach the UI as plain sentences with a kind, and never echo secrets."""

    def test_unreachable_server_is_classified_without_raw_exception_text(self):
        import requests

        from subscriptions.integrations.http import IntegrationError
        from subscriptions.integrations.jellyfin import JellyfinClient

        client = JellyfinClient("http://media.lan:8096", "secret-key")
        err = requests.ConnectionError("HTTPConnectionPool(host='media.lan'): NameResolutionError")
        with mock.patch.object(client.session, "request", side_effect=err):
            with self.assertRaises(IntegrationError) as ctx:
                client.get("/Sessions", params={"ActiveWithinSeconds": 300})
        exc = ctx.exception
        self.assertEqual(exc.kind, "unreachable")
        self.assertEqual(exc.message, "Can't reach Jellyfin at media.lan:8096.")
        self.assertNotIn("HTTPConnectionPool", exc.message)
        self.assertNotIn("ActiveWithinSeconds", exc.detail)  # query strings stay out of details
        self.assertIn("doesn't resolve", exc.detail)

    def test_rejected_api_key_is_auth_kind(self):
        from subscriptions.integrations.http import IntegrationError
        from subscriptions.integrations.tracearr import TracearrClient

        client = TracearrClient("http://tracearr.lan", "bad")
        response = mock.Mock(status_code=401, headers={}, text="nope")
        with mock.patch.object(client.session, "request", return_value=response):
            with self.assertRaises(IntegrationError) as ctx:
                client.get("/servers")
        self.assertEqual(ctx.exception.kind, "auth")
        self.assertEqual(ctx.exception.message, "Tracearr rejected the API key.")

    def test_dashboard_reports_now_playing_problem_with_kind(self):
        import requests

        s = AppSettings.load()
        s.jellyfin_url, s.jellyfin_api_key = "http://media.lan", "k"
        s.save()
        with mock.patch("requests.Session.request", side_effect=requests.ConnectTimeout("timed out")):
            data = self.client.get("/api/dashboard/").json()
        np = data["now_playing"]
        self.assertFalse(np["ok"])
        self.assertEqual(np["kind"], "timeout")
        self.assertEqual(np["error"], "Jellyfin at media.lan didn't respond within 6 seconds.")

    def test_notification_failure_never_echoes_the_webhook_secret(self):
        import requests

        from subscriptions.services.notifications import send_notification

        s = AppSettings.load()
        s.discord_webhook_url = "https://discord.com/api/webhooks/123/SUPER-SECRET-TOKEN"
        s.save()
        response = requests.Response()
        response.status_code = 404
        response.url = s.discord_webhook_url
        with mock.patch("requests.post", return_value=response):
            results = send_notification(s, "Test", "Hello")
        self.assertNotIn("SUPER-SECRET-TOKEN", results["discord"])
        self.assertTrue(results["discord"].startswith("Discord answered 404"))

    def test_api_integration_error_has_kind_and_technical(self):
        s = AppSettings.load()
        s.jellyfin_url, s.jellyfin_api_key = "http://media.lan", "k"
        s.save()
        response = mock.Mock(status_code=403, headers={}, text="")
        with mock.patch("requests.Session.request", return_value=response):
            res = self.client.post("/api/settings/test/jellyfin/", {}, format="json")
        self.assertEqual(res.status_code, 502)
        body = res.json()
        self.assertEqual(body["kind"], "auth")
        self.assertEqual(body["detail"], "Jellyfin rejected the API key.")
        self.assertIn("HTTP 403", body["technical"])


class SafeRemovalTests(AuthenticatedTestCase):
    def test_plan_in_use_cannot_be_deleted_but_can_be_archived(self):
        plan = make_plan()
        make_sub("alice", plan=plan, next_payment_date=timezone.localdate())
        res = self.client.delete(f"/api/plans/{plan.pk}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("Archive it instead", res.json()["detail"])
        self.assertTrue(Plan.objects.filter(pk=plan.pk).exists())

        res = self.client.patch(f"/api/plans/{plan.pk}/", {"is_active": False}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Subscriber.objects.get(name="alice").plan_id, plan.pk)  # still on it

    def test_unused_plan_can_be_deleted(self):
        plan = make_plan()
        self.assertEqual(self.client.delete(f"/api/plans/{plan.pk}/").status_code, 204)

    def test_deleting_latest_payment_moves_due_date_back(self):
        plan = make_plan()
        today = timezone.localdate()
        sub = make_sub("bob", plan=plan, next_payment_date=today)
        payment = self.client.post(f"/api/subscribers/{sub.pk}/payments/", {}, format="json").json()["payment"]
        sub.refresh_from_db()
        self.assertNotEqual(sub.next_payment_date, today)

        res = self.client.delete(f"/api/payments/{payment['id']}/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["due_date_reverted"])
        sub.refresh_from_db()
        self.assertEqual(sub.next_payment_date, today)

    def test_deleting_a_late_payment_restores_the_missed_due_date(self):
        plan = make_plan()
        today = timezone.localdate()
        missed = today - timezone.timedelta(days=12)
        sub = make_sub("dave", plan=plan, next_payment_date=missed)
        # Late payer: the period starts today, but the due date that gets replaced is the missed one.
        payment = self.client.post(f"/api/subscribers/{sub.pk}/payments/", {}, format="json").json()["payment"]
        res = self.client.delete(f"/api/payments/{payment['id']}/")
        self.assertTrue(res.json()["due_date_reverted"])
        sub.refresh_from_db()
        self.assertEqual(sub.next_payment_date, missed)  # still overdue, not quietly forgiven

    def test_deleting_older_payment_leaves_due_date(self):
        plan = make_plan()
        today = timezone.localdate()
        sub = make_sub("carol", plan=plan, next_payment_date=today)
        first = self.client.post(f"/api/subscribers/{sub.pk}/payments/", {}, format="json").json()["payment"]
        self.client.post(f"/api/subscribers/{sub.pk}/payments/", {}, format="json")
        sub.refresh_from_db()
        due = sub.next_payment_date
        res = self.client.delete(f"/api/payments/{first['id']}/")
        self.assertFalse(res.json()["due_date_reverted"])
        sub.refresh_from_db()
        self.assertEqual(sub.next_payment_date, due)


class ConnectionStateTests(AuthenticatedTestCase):
    def test_states_come_from_the_last_sync_not_from_having_a_url(self):
        from subscriptions.models import SyncRun

        s = self.settings_row
        s.jellyfin_url, s.jellyfin_api_key = "http://media.lan", "k"
        s.tracearr_url, s.tracearr_api_key = "http://t.lan", "k"
        s.save()
        conns = self.client.get("/api/settings/").json()["connections"]
        self.assertEqual(conns["jellyfin"]["state"], "unknown")
        self.assertEqual(conns["seerr"]["state"], "not_configured")

        run = SyncRun.objects.create(
            ok=False,
            result={
                "jellyfin": {"ok": False, "error": "Can't reach Jellyfin at media.lan.", "kind": "unreachable", "detail": "x"},
                "tracearr": {"ok": True},
            },
        )
        run.finished_at = timezone.now()
        run.save()
        conns = self.client.get("/api/sync/").json()["connections"]
        self.assertEqual(conns["jellyfin"]["state"], "error")
        self.assertEqual(conns["jellyfin"]["kind"], "unreachable")
        self.assertEqual(conns["tracearr"]["state"], "ok")
        self.assertEqual(self.client.get("/api/enforcement/").json()["jellyfin_connection"]["state"], "error")
