import json

from django.core.management.base import BaseCommand

from subscriptions.services.enforcement import run_enforcement


class Command(BaseCommand):
    help = "Disable Jellyfin accounts with lapsed subscriptions and restore the ones back in good standing."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only list what would change.")

    def handle(self, *args, **options):
        result = run_enforcement(dry_run=options["dry_run"], force=True)
        self.stdout.write(json.dumps(result, indent=2, default=str))
