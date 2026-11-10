"""Serialize contacts for API responses with optional privacy masking."""

from __future__ import annotations

from uuid import UUID

from app.models.contact import Contact
from app.schemas.contact import ContactResponse
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
) -> list[ContactResponse]:
    return [
        contact_to_response(
            item,
            role=role,
            permissions=permissions,
            privacy_mask_enabled=privacy_mask_enabled,
            last_campaign=last_campaigns.get(item.id),
        )
        for item in contacts
    ]
