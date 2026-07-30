"""Catalog commerce fields and WhatsApp Meta catalog linking."""
from alembic import op
import sqlalchemy as sa

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_products", sa.Column("category", sa.String(80), nullable=True))
    op.add_column("catalog_products", sa.Column("meta_retailer_id", sa.String(80), nullable=True))
    op.add_column("catalog_products", sa.Column("external_source", sa.String(40), nullable=True))
    op.add_column("catalog_products", sa.Column("external_id", sa.String(120), nullable=True))
    op.add_column(
        "catalog_products",
        sa.Column("usage_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index("ix_catalog_products_category", "catalog_products", ["category"])
    op.create_index("ix_catalog_products_meta_retailer_id", "catalog_products", ["meta_retailer_id"])

    op.add_column("whatsapp_accounts", sa.Column("meta_catalog_id", sa.String(80), nullable=True))
    op.add_column(
        "whatsapp_accounts",
        sa.Column("commerce_enabled", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("catalog_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_accounts", "catalog_synced_at")
    op.drop_column("whatsapp_accounts", "commerce_enabled")
    op.drop_column("whatsapp_accounts", "meta_catalog_id")
    op.drop_index("ix_catalog_products_meta_retailer_id", table_name="catalog_products")
    op.drop_index("ix_catalog_products_category", table_name="catalog_products")
    op.drop_column("catalog_products", "usage_count")
    op.drop_column("catalog_products", "external_id")
    op.drop_column("catalog_products", "external_source")
    op.drop_column("catalog_products", "meta_retailer_id")
    op.drop_column("catalog_products", "category")
