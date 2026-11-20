"""Seerr / Jellyseerr / Overseerr API v1 client (X-Api-Key)."""

from __future__ import annotations

from typing import Any, Iterator

from .http import BaseClient, IntegrationError

REQUEST_STATUS = {1: "pending", 2: "approved", 3: "declined", 4: "failed", 5: "completed"}
MEDIA_STATUS = {
    1: "unknown",
    2: "pending",
    3: "processing",
    4: "partially available",
    5: "available",
    6: "deleted",
}


class SeerrClient(BaseClient):
    service = "Seerr"

    def __init__(self, base_url: str, api_key: str):
        super().__init__(base_url)
        if not api_key:
            raise IntegrationError(self.service, f"{self.service} isn't set up yet: add its API key in Settings.", kind="not_configured")
        self.session.headers.update({"X-Api-Key": api_key})
        self._title_cache: dict[str, str] = {}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/v1/{path.lstrip('/')}"

    def get_status(self) -> dict[str, Any]:
        return self.get("/status")

    def get_main_settings(self) -> dict[str, Any]:
        return self.get("/settings/main")

    def list_users(self) -> list[dict[str, Any]]:
        users: list[dict[str, Any]] = []
        skip = 0
        take = 100
        for _ in range(100):
            page = self.get("/user", params={"take": take, "skip": skip, "sort": "created"}) or {}
            results = page.get("results") or []
            users.extend(results)
            info = page.get("pageInfo") or {}
            total = info.get("results")
            skip += take
            if not results or (total is not None and skip >= total):
                break
        return users

    def get_user_requests(self, user_id: int, take: int = 50, skip: int = 0) -> dict[str, Any]:
        return (
            self.get(
                "/request",
                params={
                    "take": take,
                    "skip": skip,
                    "requestedBy": user_id,
                    "sort": "added",
                    "sortDirection": "desc",
                    "filter": "all",
                },
            )
            or {}
        )

    def iter_user_requests(self, user_id: int, max_pages: int = 5, take: int = 50) -> Iterator[dict[str, Any]]:
        skip = 0
        for _ in range(max_pages):
            page = self.get_user_requests(user_id, take=take, skip=skip)
            results = page.get("results") or []
            if not results:
                return
            yield from results
            info = page.get("pageInfo") or {}
            total = info.get("results")
            skip += take
            if total is not None and skip >= total:
                return

    def get_media_title(self, media_type: str, tmdb_id: int | None) -> str:
        if not tmdb_id:
            return "Unknown title"
        key = f"{media_type}:{tmdb_id}"
        if key in self._title_cache:
            return self._title_cache[key]
        try:
            if media_type == "tv":
                data = self.get(f"/tv/{tmdb_id}") or {}
                title = data.get("name") or data.get("originalName") or f"TV #{tmdb_id}"
            else:
                data = self.get(f"/movie/{tmdb_id}") or {}
                title = data.get("title") or data.get("originalTitle") or f"Movie #{tmdb_id}"
        except IntegrationError:
            title = f"{media_type} #{tmdb_id}"
        self._title_cache[key] = title
        return title

    @staticmethod
    def describe_request(item: dict[str, Any]) -> dict[str, Any]:
        media = item.get("media") or {}
        return {
            "id": item.get("id"),
            "type": item.get("type") or media.get("mediaType"),
            "tmdb_id": media.get("tmdbId"),
            "tvdb_id": media.get("tvdbId"),
            "status": REQUEST_STATUS.get(item.get("status"), str(item.get("status"))),
            "media_status": MEDIA_STATUS.get(media.get("status"), str(media.get("status"))),
            "is_4k": bool(item.get("is4k")),
            "seasons": [s.get("seasonNumber") for s in (item.get("seasons") or []) if isinstance(s, dict)],
            "created_at": item.get("createdAt"),
        }
