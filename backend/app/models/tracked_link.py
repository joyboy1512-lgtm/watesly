from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TrackedLink(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tracked_links"
    __table_args__ = (UniqueConstraint("account_id", "slug", name="uq_tracked_links_account_slug"),)

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    campaign_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    phone_number: Mapped[str] = mapped_column(String(40), nullable=False)
    prefill_message: Mapped[str | None] = mapped_column(Text)
    click_count: Mapped[int] = mapped_column(Integer, default=0)


class LinkClick(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "link_clicks"

    tracked_link_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tracked_links.id", ondelete="CASCADE"), index=True
    )
    referrer: Mapped[str | None] = mapped_column(String(500))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
