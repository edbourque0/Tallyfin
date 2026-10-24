"""
Long-running scheduler: periodic sync + daily reminder digest.

Runs as its own container (same image as the API) so gunicorn workers never
run background jobs. Checks every minute; sync runs when the configured
interval has elapsed, reminders once per day at the configured local time,
and access enforcement (disable / restore Jellyfin accounts) right after each
sync and at least every five minutes.
"""

import logging
import time
from datetime import datetime, timedelta

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from subscriptions.models import AppSettings
from subscriptions.services.enforcement import run_enforcement
from subscriptions.services.reminders import run_reminders
from subscriptions.services.sync import is_sync_running, run_sync

logger = logging.getLogger(__name__)

ENFORCE_EVERY = timedelta(minutes=5)
_last_enforcement: datetime | None = None


def tick() -> None:
    global _last_enforcement
    settings = AppSettings.load()
    now = timezone.localtime()
    synced = False

    if settings.jellyfin_configured and not is_sync_running():
        interval = timedelta(minutes=max(int(settings.sync_interval_minutes or 60), 5))
        if settings.last_sync_at is None or now - settings.last_sync_at >= interval:
            logger.info("Scheduler: running sync")
            run_sync(triggered_by="scheduler")
            synced = True

    if settings.auto_disable_enabled and settings.jellyfin_configured:
        if synced or _last_enforcement is None or now - _last_enforcement >= ENFORCE_EVERY:
            result = run_enforcement()
            _last_enforcement = now
            if result.get("disabled") or result.get("enabled") or result.get("errors"):
                logger.info("Scheduler: access enforcement %s", {k: v for k, v in result.items() if k != "dry_run"})

    if settings.reminders_enabled and settings.last_reminder_run_date != now.date():
        if now.time() >= settings.reminder_time:
            logger.info("Scheduler: running reminders")
            result = run_reminders()
            logger.info("Scheduler: reminders result %s", {k: v for k, v in result.items() if k != "message"})
            AppSettings.objects.filter(pk=1).update(last_reminder_run_date=now.date())


class Command(BaseCommand):
    help = "Run the background scheduler (sync + reminders) forever."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run a single tick and exit.")
        parser.add_argument("--interval", type=int, default=60, help="Seconds between ticks.")

    def handle(self, *args, **options):
        logger.info("Scheduler started")
        while True:
            try:
                tick()
            except Exception:  # noqa: BLE001
                logger.exception("Scheduler tick failed")
            finally:
                close_old_connections()
            if options["once"]:
                return
            time.sleep(max(options["interval"], 5))
