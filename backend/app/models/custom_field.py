from uuid import UUID

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CustomFieldDefinition(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "custom_field_definitions"
    __table_args__ = (
        UniqueConstraint("account_id", "entity_type", "field_key", name="uq_custom_field_definitions_account_entity_key"),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    field_key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    field_type: Mapped[str] = mapped_column(String(40), nullable=False, default="text")
    options_json: Mapped[dict | None] = mapped_column(JSONB)


class CustomFieldValue(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "custom_field_values"
    __table_args__ = (
        UniqueConstraint("definition_id", "entity_id", name="uq_custom_field_values_definition_entity"),
    )

    definition_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("custom_field_definitions.id", ondelete="CASCADE")
    )
    entity_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), index=True)
    value_text: Mapped[str | None] = mapped_column(Text)
