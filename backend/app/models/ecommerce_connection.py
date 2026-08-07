from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class EcommerceConnection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ecommerce_connections"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    shop_label: Mapped[str] = mapped_column(String(120), nullable=False)
    shop_url: Mapped[str] = mapped_column(String(500), nullable=False)
    access_token_encrypted: Mapped[str | None] = mapped_column(Text)
    webhook_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    settings_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
