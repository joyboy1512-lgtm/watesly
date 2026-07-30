from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PlatformSiteConfig(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "platform_site_config"

    branding_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    display_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    content_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
