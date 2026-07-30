from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AccountDataKey(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "account_data_keys"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    encrypted_key: Mapped[str] = mapped_column(String(2048), nullable=False)
    key_version: Mapped[int] = mapped_column(nullable=False, default=1)
