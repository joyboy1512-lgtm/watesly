"""Company product & service catalog."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("sku", sa.String(80), nullable=True),
        sa.Column("product_type", sa.String(20), server_default="product", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency", sa.String(3), server_default="KWD", nullable=False),
        sa.Column("price_type", sa.String(20), server_default="fixed", nullable=False),
        sa.Column("specs_json", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("keywords", sa.String(500), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_catalog_products_account_id", "catalog_products", ["account_id"])
    op.create_index("ix_catalog_products_is_active", "catalog_products", ["is_active"])


def downgrade() -> None:
    op.drop_table("catalog_products")
