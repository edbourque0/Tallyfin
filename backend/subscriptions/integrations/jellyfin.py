"""Jellyfin server API client (API-key authenticated)."""

from __future__ import annotations

import logging
from typing import Any

from .http import DEFAULT_TIMEOUT, BaseClient, IntegrationError, normalize_id

logger = logging.getLogger(__name__)

CLIENT_NAME = "Tallyfin"


class JellyfinClient(BaseClient):
    service = "Jellyfin"

    def __init__(self, base_url: str, api_key: str, timeout: int = DEFAULT_TIMEOUT):
        super().__init__(base_url, timeout=timeout)
        if not api_key:
            raise IntegrationError(self.service, f"{self.service} isn't set up yet: add its API key in Settings.", kind="not_configured")
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

    def get_sessions(self, active_within_seconds: int | None = 300) -> list[dict[str, Any]]:
        params = {"ActiveWithinSeconds": active_within_seconds} if active_within_seconds else None
        data = self.get("/Sessions", params=params)
        return data if isinstance(data, list) else []

    def get_user_sessions(self, user_id: str) -> list[dict[str, Any]]:
        """Every session Jellyfin still tracks for this user (as primary or additional user)."""
        target = normalize_id(user_id)
        matches = []
        for session in self.get_sessions(active_within_seconds=None):
            ids = [session.get("UserId")] + [u.get("UserId") for u in session.get("AdditionalUsers") or []]
            if any(normalize_id(i) == target for i in ids if i):
                matches.append(session)
        return matches

    def send_message(self, session_id: str, text: str, header: str = "Subscription", timeout_ms: int = 10000) -> None:
        self.post(
            f"/Sessions/{session_id}/Message",
            json={"Text": text, "Header": header, "TimeoutMs": timeout_ms},
            expect_json=False,
        )

    def stop_playback(self, session_id: str) -> None:
        self.post(f"/Sessions/{session_id}/Playing/Stop", expect_json=False)

    def get_user_devices(self, user_id: str) -> list[dict[str, Any]]:
        data = self.get("/Devices", params={"userId": user_id}) or {}
        return data.get("Items") or []

    def delete_device(self, device_id: str) -> None:
        """Deleting a device revokes its access tokens, which logs that device out."""
        self.request("DELETE", "/Devices", params={"id": device_id}, expect_json=False)

    def logout_user_everywhere(self, user_id: str, message: str | None = None) -> dict[str, int]:
        """Stop playback, optionally show a message, then revoke every device token for the user."""
        sessions_stopped = 0
        for session in self.get_user_sessions(user_id):
            session_id = session.get("Id")
            if not session_id:
                continue
            if message:
                try:
                    self.send_message(session_id, message)
                except IntegrationError as exc:
                    logger.info("Could not message session %s: %s", session_id, exc)
            if session.get("NowPlayingItem"):
                try:
                    self.stop_playback(session_id)
                    sessions_stopped += 1
                except IntegrationError as exc:
                    logger.info("Could not stop playback on session %s: %s", session_id, exc)
        devices_removed = 0
        for device in self.get_user_devices(user_id):
            device_id = device.get("Id")
            if not device_id:
                continue
            try:
                self.delete_device(device_id)
                devices_removed += 1
            except IntegrationError as exc:
                logger.warning("Could not remove device %s: %s", device_id, exc)
        return {"sessions_stopped": sessions_stopped, "devices_removed": devices_removed}

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
