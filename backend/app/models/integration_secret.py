from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class IntegrationSecret(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "integration_secrets"
    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_integration_secrets_account_name"),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    encrypted_value: Mapped[str] = mapped_column(String(4096), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False, default=1)
