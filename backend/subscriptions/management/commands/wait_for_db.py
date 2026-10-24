"""Block until the database accepts connections, printing the real error on each attempt."""

import sys
import time

from django.core.management.base import BaseCommand
from django.db import connection
from django.db.utils import Error as DatabaseError


class Command(BaseCommand):
    help = "Wait until the configured database accepts connections."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=int, default=120, help="Seconds to keep trying (default 120).")
        parser.add_argument("--interval", type=float, default=2.0, help="Seconds between attempts.")

    def handle(self, *args, **options):
        settings = connection.settings_dict
        target = f"{settings.get('ENGINE', '').rsplit('.', 1)[-1]} {settings.get('USER') or ''}@{settings.get('HOST') or 'local'}:{settings.get('PORT') or ''}/{settings.get('NAME')}"
        deadline = time.monotonic() + options["timeout"]
        attempt = 0
        while True:
            attempt += 1
            try:
                connection.ensure_connection()
                self.stdout.write(f"Database ready ({target}).")
                return
            except DatabaseError as exc:
                message = str(exc).strip().splitlines()[0] if str(exc).strip() else exc.__class__.__name__
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.stderr.write(f"Database not reachable after {attempt} attempts ({target}): {message}")
                    sys.exit(1)
                self.stdout.write(f"Waiting for database ({target}), attempt {attempt}: {message}")
                self.stdout.flush()
                time.sleep(min(options["interval"], remaining))
