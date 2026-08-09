from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ContactInterest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "contact_interests"
    __table_args__ = (
        UniqueConstraint("contact_id", "interest_id", name="uq_contact_interests_contact_interest"),
    )

    contact_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), index=True
    )
    interest_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("interest_categories.id", ondelete="CASCADE"), index=True
    )
