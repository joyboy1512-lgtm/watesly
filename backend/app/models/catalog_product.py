from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CatalogProduct(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "catalog_products"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(80))
    product_type: Mapped[str] = mapped_column(String(20), nullable=False, default="product")
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="KWD")
    price_type: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed")
    specs_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    keywords: Mapped[str | None] = mapped_column(String(500))
    image_url: Mapped[str | None] = mapped_column(String(500))
    category: Mapped[str | None] = mapped_column(String(80), index=True)
    meta_retailer_id: Mapped[str | None] = mapped_column(String(80), index=True)
    meta_item_group_id: Mapped[str | None] = mapped_column(String(80), index=True)
    variant_size: Mapped[str | None] = mapped_column(String(40))
    variant_color: Mapped[str | None] = mapped_column(String(80))
    variant_attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    external_source: Mapped[str | None] = mapped_column(String(40))
    external_id: Mapped[str | None] = mapped_column(String(120))
    meta_sync_status: Mapped[str | None] = mapped_column(String(20), index=True)
    meta_review_status: Mapped[str | None] = mapped_column(String(20), index=True)
    meta_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta_sync_error: Mapped[str | None] = mapped_column(String(500))
    meta_review_detail: Mapped[str | None] = mapped_column(String(500))
    meta_sync_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
