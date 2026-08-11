"""Per-product Meta sync enable/disable toggle."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0051"
down_revision: str | None = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "catalog_products",
        sa.Column("meta_sync_enabled", sa.Boolean(), server_default="true", nullable=False),
    )
    op.create_index("ix_catalog_products_meta_sync_enabled", "catalog_products", ["meta_sync_enabled"])


def downgrade() -> None:
    op.drop_index("ix_catalog_products_meta_sync_enabled", table_name="catalog_products")
    op.drop_column("catalog_products", "meta_sync_enabled")
