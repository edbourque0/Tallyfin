"""Tracearr public API v2 client (Bearer token: trr_pub_...)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .http import BaseClient, IntegrationError


class TracearrClient(BaseClient):
    service = "Tracearr"

    def __init__(self, base_url: str, api_key: str):
        super().__init__(base_url)
        if not api_key:
            raise IntegrationError(self.service, "API key is not configured")
        self.session.headers.update({"Authorization": f"Bearer {api_key}"})

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/v2/public/{path.lstrip('/')}"

    def get_servers(self) -> dict[str, Any]:
        return self.get("/servers")

    def _paged(self, path: str, params: dict[str, Any] | None = None, max_pages: int = 100) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(max_pages):
            query = dict(params or {})
            query["pageSize"] = 100
            if cursor:
                query["cursor"] = cursor
            page = self.get(path, params=query) or {}
            items.extend(page.get("data") or [])
            cursor = (page.get("meta") or {}).get("nextCursor")
            if not cursor:
                break
        return items

    def list_users(self, include_removed: bool = True) -> list[dict[str, Any]]:
        """Tracearr identities, each with accounts[] carrying external_user_id per media server."""
        return self._paged("/users", {"include_removed": "true" if include_removed else "false"})

    def get_user_stats(self, user_id: str) -> dict[str, Any]:
        """Returns {user_id, windows: {all_time|last_30|last_7: {plays, watch_time_ms}}, top_genres: [...]}."""
        return self.get(f"/users/{user_id}/stats")

    def get_user_history(self, user_id: str, page_size: int = 25) -> list[dict[str, Any]]:
        page = self.get(f"/users/{user_id}/history", params={"pageSize": min(page_size, 100)}) or {}
        return page.get("data") or []

    def get_history(
        self,
        since: datetime | None = None,
        until: datetime | None = None,
        user_id: str | None = None,
        max_pages: int = 60,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if since:
            params["since"] = since.isoformat()
        if until:
            params["until"] = until.isoformat()
        if user_id:
            params["user_id"] = user_id
        return self._paged("/history", params, max_pages=max_pages)

    def get_streams(self) -> list[dict[str, Any]]:
        page = self.get("/streams") or {}
        if isinstance(page, list):
            return page
        return page.get("data") or []
