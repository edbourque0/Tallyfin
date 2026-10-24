"""Jellyfin server API client (API-key authenticated)."""

from __future__ import annotations

from typing import Any

from .http import BaseClient, IntegrationError

CLIENT_NAME = "Tallyfin"


class JellyfinClient(BaseClient):
    service = "Jellyfin"

    def __init__(self, base_url: str, api_key: str):
        super().__init__(base_url)
        if not api_key:
            raise IntegrationError(self.service, "API key is not configured")
        self.api_key = api_key
        self.session.headers.update(
            {
                "Authorization": (
                    f'MediaBrowser Token="{api_key}", Client="{CLIENT_NAME}", '
                    'Device="Server", DeviceId="tallyfin", Version="1.0.0"'
                ),
                "X-Emby-Token": api_key,
            }
        )

    def get_system_info(self) -> dict[str, Any]:
        return self.get("/System/Info")

    def get_users(self) -> list[dict[str, Any]]:
        data = self.get("/Users")
        return data if isinstance(data, list) else []

    def get_user(self, user_id: str) -> dict[str, Any]:
        return self.get(f"/Users/{user_id}")

    def set_user_disabled(self, user_id: str, disabled: bool) -> None:
        user = self.get_user(user_id)
        policy = user.get("Policy") or {}
        policy["IsDisabled"] = bool(disabled)
        self.post(f"/Users/{user_id}/Policy", json=policy, expect_json=False)

    def get_sessions(self, active_within_seconds: int = 300) -> list[dict[str, Any]]:
        data = self.get("/Sessions", params={"ActiveWithinSeconds": active_within_seconds})
        return data if isinstance(data, list) else []

    def get_now_playing(self) -> list[dict[str, Any]]:
        streams = []
        for session in self.get_sessions():
            item = session.get("NowPlayingItem")
            if not item:
                continue
            play_state = session.get("PlayState") or {}
            streams.append(
                {
                    "user_id": session.get("UserId"),
                    "user_name": session.get("UserName"),
                    "title": item.get("Name"),
                    "series": item.get("SeriesName"),
                    "type": item.get("Type"),
                    "season": item.get("ParentIndexNumber"),
                    "episode": item.get("IndexNumber"),
                    "device": session.get("DeviceName"),
                    "client": session.get("Client"),
                    "paused": bool(play_state.get("IsPaused")),
                    "play_method": play_state.get("PlayMethod"),
                    "position_ticks": play_state.get("PositionTicks"),
                    "runtime_ticks": item.get("RunTimeTicks"),
                }
            )
        return streams

    def get_user_image(self, user_id: str, width: int = 96) -> tuple[bytes, str]:
        response = self.request(
            "GET",
            f"/Users/{user_id}/Images/Primary",
            params={"width": width, "quality": 85},
            expect_json=False,
        )
        content_type = response.headers.get("Content-Type", "image/jpeg")
        return response.content, content_type
