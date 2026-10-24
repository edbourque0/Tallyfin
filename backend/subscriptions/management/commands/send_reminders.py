import json

from django.core.management.base import BaseCommand

from subscriptions.services.reminders import run_reminders


class Command(BaseCommand):
    help = "Send the reminder digest for everything due today (or preview it with --dry-run)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        result = run_reminders(force=True, dry_run=options["dry_run"])
        self.stdout.write(json.dumps(result, indent=2, default=str))
