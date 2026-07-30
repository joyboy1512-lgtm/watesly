from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class Contact(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "channel_id", "external_address",
            name="uq_contacts_org_channel_address",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    external_address: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(320))
    language: Mapped[str | None] = mapped_column(String(10))
    country_code: Mapped[str | None] = mapped_column(String(2))
    gender: Mapped[str] = mapped_column(String(10), default="unknown", server_default="unknown")
    marketing_opt_in: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    source_campaign_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="SET NULL"), index=True
    )
    source_tracked_link_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tracked_links.id", ondelete="SET NULL"), index=True
    )
