from uuid import UUID

from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ResourceRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "resource_records"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "resource_type", "resource_id",
            name="uq_resource_records_account_type_id",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    resource_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    resource_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    owner_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    version: Mapped[int] = mapped_column(nullable=False, default=1)
    details: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
