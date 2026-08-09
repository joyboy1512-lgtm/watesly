from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InterestCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "interest_categories"
    __table_args__ = (
        UniqueConstraint("account_id", "slug", name="uq_interest_categories_account_slug"),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    exclude_genders: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    include_genders: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
