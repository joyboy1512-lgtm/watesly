"""Catalog product Meta sync and review status."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_products", sa.Column("meta_sync_status", sa.String(20), nullable=True))
    op.add_column("catalog_products", sa.Column("meta_review_status", sa.String(20), nullable=True))
    op.add_column(
        "catalog_products",
        sa.Column("meta_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("catalog_products", sa.Column("meta_sync_error", sa.String(500), nullable=True))
    op.add_column("catalog_products", sa.Column("meta_review_detail", sa.String(500), nullable=True))
    op.create_index("ix_catalog_products_meta_sync_status", "catalog_products", ["meta_sync_status"])
    op.create_index("ix_catalog_products_meta_review_status", "catalog_products", ["meta_review_status"])

    op.execute(
        """
        UPDATE catalog_products
        SET meta_sync_status = 'synced'
        WHERE external_source = 'meta'
          AND external_id IS NOT NULL
          AND external_id != ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_catalog_products_meta_review_status", table_name="catalog_products")
    op.drop_index("ix_catalog_products_meta_sync_status", table_name="catalog_products")
    op.drop_column("catalog_products", "meta_review_detail")
    op.drop_column("catalog_products", "meta_sync_error")
    op.drop_column("catalog_products", "meta_synced_at")
    op.drop_column("catalog_products", "meta_review_status")
    op.drop_column("catalog_products", "meta_sync_status")
