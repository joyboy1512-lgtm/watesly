"""Serialize contacts for API responses with optional privacy masking."""

from __future__ import annotations

from uuid import UUID

from app.models.contact import Contact
from app.schemas.contact import ContactResponse
from app.services.contact_reachability import resolve_whatsapp_contact_status, whatsapp_status_label
from app.services.privacy_mask import can_view_full_contact, mask_contact_fields


def _role_value(role) -> str:
    return role.value if hasattr(role, "value") else str(role)


def contact_to_response(
    contact: Contact,
    *,
    role,
    permissions: set[str],
    privacy_mask_enabled: bool = True,
    last_campaign: dict | None = None,
    interest_ids: list[UUID] | None = None,
    interest_labels: list[str] | None = None,
    tag_ids: list[UUID] | None = None,
    tag_labels: list[str] | None = None,
) -> ContactResponse:
    show_full = not privacy_mask_enabled or can_view_full_contact(
        role=_role_value(role),
        permissions=permissions,
    )
    data = ContactResponse.model_validate(contact).model_dump()
    if last_campaign:
        data["last_campaign_id"] = last_campaign.get("last_campaign_id")
        data["last_campaign_name"] = last_campaign.get("last_campaign_name")
        data["last_campaign_at"] = last_campaign.get("last_campaign_at")
    data["interest_ids"] = list(interest_ids or [])
    data["interest_labels"] = list(interest_labels or [])
    data["tag_ids"] = list(tag_ids or [])
    data["tag_labels"] = list(tag_labels or [])
    wa_status = resolve_whatsapp_contact_status(contact)
    data["whatsapp_status"] = wa_status.value
    data["whatsapp_status_label"] = whatsapp_status_label(wa_status)
    if not show_full:
        data = mask_contact_fields(data, show_full=False)
    return ContactResponse(**data)


def attach_last_campaigns(
    contacts: list[Contact],
    *,
    role,
    permissions: set[str],
    privacy_mask_enabled: bool,
    last_campaigns: dict[UUID, dict],
    interests_by_contact: dict[UUID, list] | None = None,
    tags_by_contact: dict[UUID, list] | None = None,
) -> list[ContactResponse]:
    interests_by_contact = interests_by_contact or {}
    tags_by_contact = tags_by_contact or {}
    rows: list[ContactResponse] = []
    for item in contacts:
        interest_rows = interests_by_contact.get(item.id) or []
        tag_rows = tags_by_contact.get(item.id) or []
        rows.append(
            contact_to_response(
                item,
                role=role,
                permissions=permissions,
                privacy_mask_enabled=privacy_mask_enabled,
                last_campaign=last_campaigns.get(item.id),
                interest_ids=[category.id for category in interest_rows],
                interest_labels=[category.label for category in interest_rows],
                tag_ids=[tag.id for tag in tag_rows],
                tag_labels=[tag.name for tag in tag_rows],
            )
        )
    return rows
