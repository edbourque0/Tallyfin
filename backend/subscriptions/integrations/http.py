"""Shared HTTP helpers for the integration clients."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 20


class IntegrationError(Exception):
    """Raised when a third-party service cannot be reached or returns an error."""

    def __init__(self, service: str, message: str):
        super().__init__(f"{service}: {message}")
        self.service = service
        self.message = message


class BaseClient:
    service = "service"

    def __init__(self, base_url: str, timeout: int = DEFAULT_TIMEOUT):
        if not base_url:
            raise IntegrationError(self.service, "URL is not configured")
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
                raise IntegrationError(self.service, f"could not reach {url} ({exc.__class__.__name__}: {exc})") from exc

            if response.status_code == 429 and attempt <= retries:
                wait = response.headers.get("Retry-After")
                delay = float(wait) if wait and wait.replace(".", "", 1).isdigit() else 2.0 * attempt
                logger.info("%s rate limited, retrying in %.1fs", self.service, delay)
                time.sleep(min(delay, 30))
                continue

            if response.status_code in (401, 403):
                raise IntegrationError(self.service, f"authentication failed (HTTP {response.status_code}); check the API key")
            if response.status_code == 404:
                raise IntegrationError(self.service, f"not found (HTTP 404) at {url}")
            if response.status_code >= 400:
                snippet = response.text[:200].replace("\n", " ")
                raise IntegrationError(self.service, f"HTTP {response.status_code} from {url}: {snippet}")

            if not expect_json:
                return response
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError as exc:
                raise IntegrationError(self.service, f"invalid JSON from {url}") from exc

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)


def normalize_id(value: str | None) -> str:
    """Jellyfin user ids appear with and without dashes depending on the API; compare loosely."""
    if not value:
        return ""
    return str(value).replace("-", "").strip().lower()
