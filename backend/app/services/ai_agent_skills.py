"""AI agent skill schema, normalization, and HTTP skill execution."""

from __future__ import annotations

import ipaddress
import json
import re
import socket
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.feature_flags import get_feature_flags

DEFAULT_SKILLS: dict[str, Any] = {
    "assign_to_human": False,
    "update_lifecycle": False,
    "close_conversation": False,
    "http_request": False,
    "actions": [],
}

_ALLOWED_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})
_MAX_ACTIONS = 3
_HTTP_TIMEOUT_SECONDS = 15.0
_MAX_RESPONSE_BYTES = 64_000
_TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


def default_skills() -> dict[str, Any]:
    return {
        "assign_to_human": False,
        "update_lifecycle": False,
        "close_conversation": False,
        "http_request": False,
        "actions": [],
    }


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off", ""}:
            return False
    return default


def _as_str(value: Any, *, max_len: int = 2000) -> str:
    text = str(value or "").strip()
    return text[:max_len]


def _normalize_headers(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in list(raw.items())[:20]:
        name = _as_str(key, max_len=120)
        if not name:
            continue
        out[name] = _as_str(value, max_len=2000)
    return out


def _normalize_required_fields(raw: Any) -> list[str]:
    if isinstance(raw, str):
        parts = re.split(r"[,،\n]+", raw)
        return [part.strip()[:80] for part in parts if part.strip()][:20]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw[:20]:
        name = _as_str(item, max_len=80)
        if name:
            out.append(name)
    return out


def _normalize_body_template(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (dict, list)):
        return json.dumps(raw, ensure_ascii=False)[:8000]
    return _as_str(raw, max_len=8000)


def _normalize_action(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    url = _as_str(raw.get("url"), max_len=2000)
    if not url:
        return None
    method = _as_str(raw.get("method") or "POST", max_len=10).upper()
    if method not in _ALLOWED_METHODS:
        method = "POST"
    return {
        "name": _as_str(raw.get("name") or "http_action", max_len=120) or "http_action",
        "when": _as_str(raw.get("when"), max_len=500),
        "method": method,
        "url": url,
        "headers": _normalize_headers(raw.get("headers")),
        "body_template": _normalize_body_template(raw.get("body_template")),
        "required_fields": _normalize_required_fields(raw.get("required_fields")),
    }


def normalize_skills_json(raw: Any) -> dict[str, Any]:
    """Sanitize skills_json into the default skill schema."""
    base = default_skills()
    if not isinstance(raw, dict):
        return base

    base["assign_to_human"] = _as_bool(raw.get("assign_to_human"))
    base["update_lifecycle"] = _as_bool(raw.get("update_lifecycle"))
    base["close_conversation"] = _as_bool(raw.get("close_conversation"))
    base["http_request"] = _as_bool(raw.get("http_request"))

    actions_raw = raw.get("actions")
    if not isinstance(actions_raw, list):
        actions_raw = []
    actions: list[dict[str, Any]] = []
    for item in actions_raw:
        if len(actions) >= _MAX_ACTIONS:
            break
        normalized = _normalize_action(item)
        if normalized is not None:
            actions.append(normalized)
    base["actions"] = actions
    return base


def substitute_template(template: str, collected: dict[str, Any] | None) -> str:
    values = collected if isinstance(collected, dict) else {}

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in values or values[key] is None:
            return ""
        return str(values[key])

    return _TEMPLATE_RE.sub(repl, template or "")


def _host_is_blocked(hostname: str) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if not host:
        return True
    if host in {"localhost", "metadata.google.internal"}:
        return True
    if host.endswith(".local") or host.endswith(".internal"):
        return True

    try:
        ip = ipaddress.ip_address(host)
        return bool(
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        )
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True

    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


def _validate_http_url(url: str) -> str:
    cleaned = (url or "").strip()
    if not cleaned:
        raise ValueError("HTTP skill action requires a non-empty url")
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"https", "http"}:
        raise ValueError("HTTP skill URL must use http or https")
    if not parsed.hostname:
        raise ValueError("HTTP skill URL is missing a host")
    if _host_is_blocked(parsed.hostname):
        raise ValueError("HTTP skill URL targets a blocked host")
    return cleaned


async def execute_http_skill_action(
    db: AsyncSession,
    *,
    account_id: UUID,
    action: dict[str, Any],
    collected: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run one HTTP skill action when ai_agent_skills is enabled."""
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("ai_agent_skills"):
        raise ValueError("ai_agent_skills feature flag is disabled")

    if not isinstance(action, dict):
        raise ValueError("Invalid HTTP skill action")

    method = _as_str(action.get("method") or "POST", max_len=10).upper()
    if method not in _ALLOWED_METHODS:
        raise ValueError("Unsupported HTTP method")

    url_template = _as_str(action.get("url"), max_len=2000)
    url = _validate_http_url(substitute_template(url_template, collected))

    headers_raw = action.get("headers") if isinstance(action.get("headers"), dict) else {}
    headers = {
        key: substitute_template(str(value), collected)
        for key, value in _normalize_headers(headers_raw).items()
    }

    body_template = _normalize_body_template(action.get("body_template"))
    body_text = substitute_template(body_template, collected) if body_template else ""

    content: bytes | None = None
    json_body: Any | None = None
    if method != "GET" and body_text:
        try:
            json_body = json.loads(body_text)
        except json.JSONDecodeError:
            content = body_text.encode("utf-8")
            headers.setdefault("Content-Type", "text/plain; charset=utf-8")

    async with httpx.AsyncClient(
        timeout=_HTTP_TIMEOUT_SECONDS,
        follow_redirects=False,
    ) as client:
        response = await client.request(
            method,
            url,
            headers=headers or None,
            json=json_body,
            content=content,
        )

    raw = response.content[:_MAX_RESPONSE_BYTES]
    truncated = len(response.content) > _MAX_RESPONSE_BYTES
    try:
        text = raw.decode(response.encoding or "utf-8", errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")

    return {
        "ok": response.is_success,
        "status_code": response.status_code,
        "method": method,
        "url": url,
        "body": text,
        "truncated": truncated,
        "headers": dict(list(response.headers.items())[:30]),
    }


_CLOSE_HINTS = (
    "تم الحل",
    "خلاص",
    "شكرا تم",
    "مع السلامة",
    "bye",
    "thanks that's all",
    "resolved",
)


async def apply_inbound_skills(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation,
    contact,
    agent_settings: dict[str, Any],
    inbound_text: str,
    escalated: bool,
    auto_sent: bool,
) -> dict[str, Any]:
    """Apply enabled agent skills after an inbound AI turn (flag-gated)."""
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("ai_agent_skills"):
        return {"skipped": True, "reason": "flag_off"}

    skills = normalize_skills_json(agent_settings.get("skills_json"))
    results: dict[str, Any] = {"applied": []}
    text = (inbound_text or "").strip()
    text_l = text.lower()

    if escalated and skills.get("assign_to_human") and getattr(conversation, "assigned_membership_id", None) is None:
        from app.services.assignments import auto_assign_conversation

        member = await auto_assign_conversation(db, conversation=conversation)
        if member is not None:
            results["applied"].append({"skill": "assign_to_human", "membership_id": str(member.id)})

    if escalated and skills.get("update_lifecycle") and contact is not None:
        current = str(getattr(contact, "lifecycle_stage", "") or "").strip().lower()
        if current in {"", "lead", "new", "prospect"}:
            contact.lifecycle_stage = "qualified"
            results["applied"].append({"skill": "update_lifecycle", "lifecycle_stage": "qualified"})

    if skills.get("close_conversation") and auto_sent and any(hint in text_l for hint in _CLOSE_HINTS):
        from datetime import UTC, datetime

        from app.models.conversation import ConversationStatus

        conversation.status = ConversationStatus.CLOSED
        conversation.closed_at = datetime.now(UTC)
        conversation.archived_at = datetime.now(UTC)
        results["applied"].append({"skill": "close_conversation"})

    if skills.get("http_request") and (auto_sent or escalated):
        for action in skills.get("actions") or []:
            when = str(action.get("when") or "").strip().lower()
            if not when or when not in text_l:
                continue
            required = action.get("required_fields") or []
            collected = {
                "text": text,
                "contact_id": str(getattr(contact, "id", "") or ""),
                "conversation_id": str(getattr(conversation, "id", "") or ""),
                "phone": str(getattr(contact, "external_address", "") or ""),
            }
            missing = [field for field in required if not str(collected.get(field) or "").strip()]
            if missing:
                results.setdefault("http_skipped", []).append(
                    {"name": action.get("name"), "missing": missing}
                )
                continue
            try:
                http_result = await execute_http_skill_action(
                    db,
                    account_id=account_id,
                    action=action,
                    collected=collected,
                )
                results["applied"].append(
                    {
                        "skill": "http_request",
                        "name": action.get("name"),
                        "status_code": http_result.get("status_code"),
                        "ok": http_result.get("ok"),
                    }
                )
            except Exception as exc:  # noqa: BLE001 — skill must not break inbound
                results.setdefault("http_errors", []).append(
                    {"name": action.get("name"), "error": str(exc)[:200]}
                )

    return results
