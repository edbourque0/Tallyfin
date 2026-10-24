import json

from django.core.management.base import BaseCommand

from subscriptions.services.sync import run_sync


class Command(BaseCommand):
    help = "Sync subscribers and usage from Jellyfin, Tracearr and Seerr now."

    def handle(self, *args, **options):
        run = run_sync(triggered_by="cli")
        self.stdout.write(json.dumps(run.result, indent=2, default=str))
