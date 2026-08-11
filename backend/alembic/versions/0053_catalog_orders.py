"""Catalog orders from WhatsApp commerce."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_orders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel_id", UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("message_id", UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("order_number", sa.String(32), nullable=False),
        sa.Column("meta_catalog_id", sa.String(80), nullable=True),
        sa.Column("customer_note", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="KWD"),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="received"),
        sa.Column("line_items", JSONB(), nullable=False, server_default="[]"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reviewed_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("message_id", name="uq_catalog_orders_message_id"),
    )
    op.create_index("ix_catalog_orders_account_id", "catalog_orders", ["account_id"])
    op.create_index("ix_catalog_orders_organization_id", "catalog_orders", ["organization_id"])
    op.create_index("ix_catalog_orders_contact_id", "catalog_orders", ["contact_id"])
    op.create_index("ix_catalog_orders_order_number", "catalog_orders", ["order_number"])
    op.create_index("ix_catalog_orders_status", "catalog_orders", ["status"])
    op.create_index("ix_catalog_orders_created_at", "catalog_orders", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_catalog_orders_created_at", table_name="catalog_orders")
    op.drop_index("ix_catalog_orders_status", table_name="catalog_orders")
    op.drop_index("ix_catalog_orders_order_number", table_name="catalog_orders")
    op.drop_index("ix_catalog_orders_contact_id", table_name="catalog_orders")
    op.drop_index("ix_catalog_orders_organization_id", table_name="catalog_orders")
    op.drop_index("ix_catalog_orders_account_id", table_name="catalog_orders")
    op.drop_table("catalog_orders")
