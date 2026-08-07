from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class OrderMessageTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_message_templates"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    ecommerce_connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("ecommerce_connections.id", ondelete="CASCADE"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    template_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("whatsapp_templates.id", ondelete="RESTRICT")
    )
    whatsapp_account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("whatsapp_accounts.id", ondelete="CASCADE")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    variable_mapping: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
