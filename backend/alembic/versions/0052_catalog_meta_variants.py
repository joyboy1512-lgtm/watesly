"""Meta catalog product variant fields (item_group_id, size, color)."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_products", sa.Column("meta_item_group_id", sa.String(80), nullable=True))
    op.add_column("catalog_products", sa.Column("variant_size", sa.String(40), nullable=True))
    op.add_column("catalog_products", sa.Column("variant_color", sa.String(80), nullable=True))
    op.add_column(
        "catalog_products",
        sa.Column("variant_attributes", JSONB(), server_default="{}", nullable=False),
    )
    op.create_index("ix_catalog_products_meta_item_group_id", "catalog_products", ["meta_item_group_id"])


def downgrade() -> None:
    op.drop_index("ix_catalog_products_meta_item_group_id", table_name="catalog_products")
    op.drop_column("catalog_products", "variant_attributes")
    op.drop_column("catalog_products", "variant_color")
    op.drop_column("catalog_products", "variant_size")
    op.drop_column("catalog_products", "meta_item_group_id")
