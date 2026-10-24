"""Outbound notification channels for reminders (Discord, ntfy, Gotify, Telegram, webhook, email)."""

from __future__ import annotations

import logging
from typing import Any

import requests
from django.core.mail import EmailMessage, get_connection

from ..models import AppSettings

logger = logging.getLogger(__name__)
TIMEOUT = 15
ACCENT_COLOR = 0xA855F7


def configured_channels(s: AppSettings) -> list[str]:
    channels = []
    if s.discord_webhook_url:
        channels.append("discord")
    if s.ntfy_url and s.ntfy_topic:
        channels.append("ntfy")
    if s.gotify_url and s.gotify_token:
        channels.append("gotify")
    if s.telegram_bot_token and s.telegram_chat_id:
        channels.append("telegram")
    if s.webhook_url:
        channels.append("webhook")
    if s.email_host and s.email_to:
        channels.append("email")
    return channels


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _send_discord(s: AppSettings, title: str, message: str, items: list[dict[str, Any]]) -> None:
    payload = {
        "username": "Tallyfin",
        "embeds": [{"title": _truncate(title, 256), "description": _truncate(message, 4000), "color": ACCENT_COLOR}],
    }
    response = requests.post(s.discord_webhook_url, json=payload, timeout=TIMEOUT)
    response.raise_for_status()


def _send_ntfy(s: AppSettings, title: str, message: str, items: list[dict[str, Any]]) -> None:
    url = f"{s.ntfy_url.rstrip('/')}/{s.ntfy_topic.strip('/')}"
    headers = {"Title": title.encode("ascii", "ignore").decode(), "Tags": "money_with_wings", "Priority": "default"}
    if s.ntfy_token:
        headers["Authorization"] = f"Bearer {s.ntfy_token}"
    response = requests.post(url, data=message.encode("utf-8"), headers=headers, timeout=TIMEOUT)
    response.raise_for_status()


def _send_gotify(s: AppSettings, title: str, message: str, items: list[dict[str, Any]]) -> None:
    url = f"{s.gotify_url.rstrip('/')}/message"
    response = requests.post(
        url,
        params={"token": s.gotify_token},
        json={"title": title, "message": message, "priority": 5},
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def _send_telegram(s: AppSettings, title: str, message: str, items: list[dict[str, Any]]) -> None:
    url = f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage"
    response = requests.post(
        url,
        json={"chat_id": s.telegram_chat_id, "text": _truncate(f"{title}\n\n{message}", 4000)},
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def _send_webhook(s: AppSettings, title: str, message: str, items: list[dict[str, Any]]) -> None:
    response = requests.post(
        s.webhook_url,
        json={"source": "tallyfin", "title": title, "message": message, "items": items},
        timeout=TIMEOUT,
    )
    response.raise_for_status()


def _send_email(s: AppSettings, title: str, message: str, items: list[dict[str, Any]]) -> None:
    connection = get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=s.email_host,
        port=s.email_port or 587,
        username=s.email_user or None,
        password=s.email_password or None,
        use_tls=bool(s.email_use_tls),
        use_ssl=not s.email_use_tls and (s.email_port == 465),
        timeout=TIMEOUT,
    )
    recipients = [addr.strip() for addr in s.email_to.split(",") if addr.strip()]
    sender = s.email_from or s.email_user or "subscriptions@localhost"
    email = EmailMessage(subject=title, body=message, from_email=sender, to=recipients, connection=connection)
    email.send(fail_silently=False)


SENDERS = {
    "discord": _send_discord,
    "ntfy": _send_ntfy,
    "gotify": _send_gotify,
    "telegram": _send_telegram,
    "webhook": _send_webhook,
    "email": _send_email,
}


def send_notification(
    s: AppSettings,
    title: str,
    message: str,
    items: list[dict[str, Any]] | None = None,
    only: list[str] | None = None,
) -> dict[str, str]:
    """Send to every configured channel. Returns {channel: "ok" | "error text"}."""
    results: dict[str, str] = {}
    channels = configured_channels(s)
    if only:
        channels = [c for c in channels if c in only]
    for channel in channels:
        try:
            SENDERS[channel](s, title, message, items or [])
            results[channel] = "ok"
        except Exception as exc:  # noqa: BLE001 - report every failure to the UI
            logger.warning("Notification via %s failed: %s", channel, exc)
            results[channel] = str(exc)[:300]
    return results
