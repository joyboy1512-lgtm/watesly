"""Parse inbound WhatsApp interactive replies (buttons, lists)."""

from __future__ import annotations


def extract_interactive_reply(message_item: dict) -> dict | None:
    interactive = message_item.get("interactive")
    if not isinstance(interactive, dict):
        return None
    interactive_type = str(interactive.get("type") or "").lower()
    if interactive_type == "button_reply":
        reply = interactive.get("button_reply") or {}
        return {
            "interactive_type": "button_reply",
            "button_id": str(reply.get("id") or ""),
            "button_title": str(reply.get("title") or ""),
            "text": str(reply.get("title") or ""),
        }
    if interactive_type == "list_reply":
        reply = interactive.get("list_reply") or {}
        return {
            "interactive_type": "list_reply",
            "list_id": str(reply.get("id") or ""),
            "list_title": str(reply.get("title") or ""),
            "list_description": str(reply.get("description") or ""),
            "text": str(reply.get("title") or ""),
        }
    if interactive_type == "nfm_reply":
        reply = interactive.get("nfm_reply") or {}
        return {
            "interactive_type": "nfm_reply",
            "response_json": reply.get("response_json"),
            "text": "Flow response",
        }
    return None
