"""Create the first admin user from ADMIN_USERNAME / ADMIN_PASSWORD if no user exists yet."""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the initial admin user from environment variables (no-op if users exist)."

    def handle(self, *args, **options):
        User = get_user_model()
        if User.objects.exists():
            self.stdout.write("Users already exist; skipping bootstrap.")
            return
        if not settings.ADMIN_PASSWORD:
            self.stdout.write("ADMIN_PASSWORD not set; the web UI will ask you to create the admin on first visit.")
            return
        User.objects.create_superuser(username=settings.ADMIN_USERNAME, password=settings.ADMIN_PASSWORD)
        self.stdout.write(f"Created admin user '{settings.ADMIN_USERNAME}'.")
