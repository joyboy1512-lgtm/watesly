"""Business hours helpers for AI agent and automations."""

from __future__ import annotations

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

DEFAULT_HOURS = {
    "timezone": "Asia/Kuwait",
    "days": {
        "mon": ["09:00", "18:00"],
        "tue": ["09:00", "18:00"],
        "wed": ["09:00", "18:00"],
        "thu": ["09:00", "18:00"],
        "fri": ["09:00", "18:00"],
        "sat": None,
        "sun": None,
    },
}

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _parse_slot(raw: list | None) -> tuple[time, time] | None:
    if not raw or len(raw) < 2:
        return None
    start = datetime.strptime(str(raw[0]), "%H:%M").time()
    end = datetime.strptime(str(raw[1]), "%H:%M").time()
    return start, end


def is_within_business_hours(config: dict | None, *, now: datetime | None = None) -> bool:
    cfg = config or DEFAULT_HOURS
    timezone_name = str(cfg.get("timezone") or "Asia/Kuwait")
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        tz = ZoneInfo("Asia/Kuwait")
    local_now = (now or datetime.now(UTC)).astimezone(tz)
    day_key = DAY_KEYS[local_now.weekday()]
    slot = _parse_slot((cfg.get("days") or {}).get(day_key))
    if slot is None:
        return False
    start, end = slot
    current = local_now.time()
    return start <= current <= end
