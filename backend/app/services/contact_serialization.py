"""Serialize contacts for API responses with optional privacy masking."""

from __future__ import annotations

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
) -> ContactResponse:
    show_full = not privacy_mask_enabled or can_view_full_contact(
        role=_role_value(role),
        permissions=permissions,
    )
    data = ContactResponse.model_validate(contact).model_dump()
    if not show_full:
        data = mask_contact_fields(data, show_full=False)
    return ContactResponse(**data)
