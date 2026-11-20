"""Shared HTTP helpers for the integration clients."""

from __future__ import annotations

import logging
import smtplib
import socket
import time
from typing import Any
from urllib.parse import urlsplit

import requests

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 20


class IntegrationError(Exception):
    """Raised when a third-party service cannot be reached or returns an error.

    ``message`` is a full sentence meant for the admin ("Can't reach Jellyfin at media.lan.").
    ``kind`` lets the UI pick a next step: unreachable, timeout, auth, not_found, http,
    bad_response, rate_limited, not_configured.
    ``detail`` is the technical cause, for logs and a collapsed "technical details" disclosure.
    It never contains query strings or credentials.
    """

    def __init__(self, service: str, message: str, *, kind: str = "error", detail: str = ""):
        super().__init__(f"{service}: {detail or message}")
        self.service = service
        self.message = message
        self.kind = kind
        self.detail = detail

    def as_dict(self) -> dict[str, str]:
        return {"service": self.service, "kind": self.kind, "message": self.message, "detail": self.detail}


def safe_url(url: str) -> str:
    """Scheme, host and path only: query strings can carry tokens (Gotify does)."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}" if parts.netloc else ""


def host_of(url: str) -> str:
    return urlsplit(url).netloc or url


def describe_failure(exc: BaseException, timeout: int | float | None = None) -> tuple[str, str]:
    """(kind, short human clause) for a failed outbound call, never echoing URLs or secrets.

    The clause completes "<channel or service> ..." e.g. "couldn't be reached".
    """
    if isinstance(exc, requests.Timeout):
        return "timeout", f"didn't respond within {int(timeout)} seconds" if timeout else "didn't respond in time"
    if isinstance(exc, requests.ConnectionError):
        return "unreachable", "couldn't be reached"
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        code = exc.response.status_code
        if code in (401, 403):
            return "auth", f"rejected the credentials (HTTP {code})"
        if code == 404:
            return "not_found", "answered 404; check the URL, topic or chat ID"
        if code == 429:
            return "rate_limited", "is rate-limiting requests; try again in a minute"
        return "http", f"returned an error (HTTP {code})"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "auth", "rejected the username or password"
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, ConnectionRefusedError, socket.gaierror)):
        return "unreachable", "couldn't reach the mail server"
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "timeout", "didn't respond in time"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "http", "refused the recipient address"
    return "error", f"failed ({exc.__class__.__name__})"


class BaseClient:
    service = "service"

    def __init__(self, base_url: str, timeout: int = DEFAULT_TIMEOUT):
        if not base_url:
            raise IntegrationError(self.service, f"{self.service} isn't set up yet: add its URL in Settings.", kind="not_configured")
        self.base_url = base_url.strip().rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json", "User-Agent": "Tallyfin/1.0"})

    def _url(self, path: str) -> str:
        return f"{self.base_url}/{path.lstrip('/')}"

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        data: Any = None,
        headers: dict[str, str] | None = None,
        expect_json: bool = True,
        retries: int = 2,
    ) -> Any:
        url = self._url(path)
        attempt = 0
        while True:
            attempt += 1
            try:
                response = self.session.request(
                    method,
                    url,
                    params=params,
                    json=json,
                    data=data,
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                host = host_of(self.base_url)
                technical = f"{method} {safe_url(url)} -> {exc.__class__.__name__}"
                if isinstance(exc, requests.Timeout):
                    raise IntegrationError(
                        self.service, f"{self.service} at {host} didn't respond within {self.timeout} seconds.", kind="timeout", detail=technical
                    ) from exc
                if isinstance(exc, requests.ConnectionError):
                    cause = "the address doesn't resolve" if "NameResolution" in str(exc) or "Name or service not known" in str(exc) else (
                        "the connection was refused" if "refused" in str(exc).lower() else "no connection"
                    )
                    raise IntegrationError(
                        self.service, f"Can't reach {self.service} at {host}.", kind="unreachable", detail=f"{technical} ({cause})"
                    ) from exc
                raise IntegrationError(self.service, f"The request to {self.service} failed.", kind="error", detail=technical) from exc

            if response.status_code == 429 and attempt <= retries:
                wait = response.headers.get("Retry-After")
                delay = float(wait) if wait and wait.replace(".", "", 1).isdigit() else 2.0 * attempt
                logger.info("%s rate limited, retrying in %.1fs", self.service, delay)
                time.sleep(min(delay, 30))
                continue

            technical = f"{method} {safe_url(url)} -> HTTP {response.status_code}"
            if response.status_code == 429:
                raise IntegrationError(
                    self.service, f"{self.service} is rate-limiting Tallyfin. It will retry on the next sync.", kind="rate_limited", detail=technical
                )
            if response.status_code in (401, 403):
                raise IntegrationError(self.service, f"{self.service} rejected the API key.", kind="auth", detail=technical)
            if response.status_code == 404:
                raise IntegrationError(
                    self.service,
                    f"{self.service} answered, but not at the expected address. Check the server URL.",
                    kind="not_found",
                    detail=technical,
                )
            if response.status_code >= 400:
                snippet = response.text[:200].replace("\n", " ").strip()
                raise IntegrationError(
                    self.service,
                    f"{self.service} returned an error (HTTP {response.status_code}).",
                    kind="http",
                    detail=f"{technical}: {snippet}" if snippet else technical,
                )

            if not expect_json:
                return response
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError as exc:
                raise IntegrationError(
                    self.service,
                    f"{self.service} sent a response Tallyfin couldn't read. Check that the URL points to {self.service}.",
                    kind="bad_response",
                    detail=f"{method} {safe_url(url)} -> not JSON",
                ) from exc

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)


def normalize_id(value: str | None) -> str:
    """Jellyfin user ids appear with and without dashes depending on the API; compare loosely."""
    if not value:
        return ""
    return str(value).replace("-", "").strip().lower()
