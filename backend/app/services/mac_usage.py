"""Central MAC usage service — event-driven, idempotent, multi-tenant safe."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.mac_activation_audit import MacActivationAudit
from app.models.monthly_active_contact import MacTriggerSource, MonthlyActiveContact
from app.services.billing_period import cycle_month_key, resolve_channel_billing_period


class MacActivityType(StrEnum):
    MESSAGE_INBOUND = "message_inbound"
    MESSAGE_OUTBOUND = "message_outbound"
    CALL = "call"
    BROADCAST = "broadcast"

    @classmethod
    def from_trigger(cls, trigger: MacTriggerSource) -> MacActivityType:
        mapping = {
            MacTriggerSource.INBOUND: cls.MESSAGE_INBOUND,
            MacTriggerSource.INBOX_OUTBOUND: cls.MESSAGE_OUTBOUND,
            MacTriggerSource.AI_OUTBOUND: cls.MESSAGE_OUTBOUND,
        }
        return mapping.get(trigger, cls.MESSAGE_OUTBOUND)


MAC_COUNTED_ACTIVITIES = frozenset(
    {
        MacActivityType.MESSAGE_INBOUND,
        MacActivityType.MESSAGE_OUTBOUND,
        MacActivityType.CALL,
    }
)


@dataclass
class MacActivityResult:
    created: bool
    mac_record_id: UUID | None = None
    reason: str = ""


async def record_activity(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    channel_id: UUID,
    activity_type: MacActivityType | MacTriggerSource | str,
    activity_at: datetime | None = None,
    organization_id: UUID | None = None,
    source_event_id: str | None = None,
    message_id: UUID | None = None,
    metadata: dict | None = None,
) -> MacActivityResult:
    """Record MAC for qualifying activity. Broadcast and duplicates are ignored."""
    if contact_id is None:
        return MacActivityResult(created=False, reason="missing_contact")

    if isinstance(activity_type, MacTriggerSource):
        trigger_source = activity_type
        activity = MacActivityType.from_trigger(activity_type)
    else:
        activity = MacActivityType(str(activity_type))
        trigger_source = _activity_to_trigger(activity)

    if activity == MacActivityType.BROADCAST or activity not in MAC_COUNTED_ACTIVITIES:
        return MacActivityResult(created=False, reason="activity_not_counted")

    at = activity_at or datetime.now(UTC)
    period = await resolve_channel_billing_period(db, channel_id=channel_id, reference=at)
    if period is None:
        return MacActivityResult(created=False, reason="no_billing_period")
    period_start, period_end = period

    if source_event_id:
        existing_event = await db.scalar(
            select(MacActivationAudit.id).where(
                MacActivationAudit.account_id == account_id,
                MacActivationAudit.source_event_id == source_event_id,
            )
        )
        if existing_event is not None:
            return MacActivityResult(created=False, reason="duplicate_event")

    org_id = organization_id
    if org_id is None:
        contact = await db.get(Contact, contact_id)
        org_id = contact.organization_id if contact else None

    mac_id = uuid4()
    stmt = (
        insert(MonthlyActiveContact)
        .values(
            id=mac_id,
            account_id=account_id,
            organization_id=org_id,
            channel_id=channel_id,
            contact_id=contact_id,
            cycle_month=cycle_month_key(period_start),
            billing_period_start=period_start,
            billing_period_end=period_end,
            trigger_source=trigger_source.value,
            first_activity_at=at,
            last_active_at=at,
            source_event_id=source_event_id,
        )
        .on_conflict_do_nothing(constraint="uq_mac_account_channel_contact_billing_period")
    )
    result = await db.execute(stmt)
    created = result.rowcount > 0

    if not created:
        await db.execute(
            update(MonthlyActiveContact)
            .where(
                MonthlyActiveContact.account_id == account_id,
                MonthlyActiveContact.channel_id == channel_id,
                MonthlyActiveContact.contact_id == contact_id,
                MonthlyActiveContact.billing_period_start == period_start,
            )
            .values(last_active_at=at)
        )
        existing_mac = await db.scalar(
            select(MonthlyActiveContact.id).where(
                MonthlyActiveContact.account_id == account_id,
                MonthlyActiveContact.channel_id == channel_id,
                MonthlyActiveContact.contact_id == contact_id,
                MonthlyActiveContact.billing_period_start == period_start,
            )
        )
        mac_id = existing_mac

    audit = MacActivationAudit(
        id=uuid4(),
        account_id=account_id,
        organization_id=org_id,
        contact_id=contact_id,
        channel_id=channel_id,
        mac_record_id=mac_id if created else mac_id,
        billing_period_start=period_start,
        billing_period_end=period_end,
        activity_type=activity.value,
        activation_source=trigger_source.value,
        source_event_id=source_event_id,
        message_id=message_id,
        metadata_json=json.dumps(metadata or {}, default=str) if metadata else None,
        created_new_mac=created,
        created_at=at,
    )
    db.add(audit)
    await db.flush()

    return MacActivityResult(
        created=created,
        mac_record_id=mac_id,
        reason="created" if created else "already_active",
    )


def _activity_to_trigger(activity: MacActivityType) -> MacTriggerSource:
    if activity == MacActivityType.MESSAGE_INBOUND:
        return MacTriggerSource.INBOUND
    if activity == MacActivityType.CALL:
        return MacTriggerSource.INBOUND
    return MacTriggerSource.INBOX_OUTBOUND


async def record_mac(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    contact_id: UUID,
    trigger_source: MacTriggerSource,
    activity_at: datetime | None = None,
    organization_id: UUID | None = None,
    source_event_id: str | None = None,
    message_id: UUID | None = None,
) -> bool:
    """Backward-compatible wrapper used by existing call sites."""
    result = await record_activity(
        db,
        account_id=account_id,
        contact_id=contact_id,
        channel_id=channel_id,
        activity_type=trigger_source,
        activity_at=activity_at,
        organization_id=organization_id,
        source_event_id=source_event_id,
        message_id=message_id,
    )
    return result.created
