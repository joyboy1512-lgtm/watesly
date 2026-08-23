"""Optional channel scope for catalog products."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0059_catalog_product_channel"
down_revision = "0058_whatsapp_branding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "catalog_products",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_catalog_products_channel_id",
        "catalog_products",
        "channels",
        ["channel_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_catalog_products_channel_id", "catalog_products", ["channel_id"])


def downgrade() -> None:
    op.drop_index("ix_catalog_products_channel_id", table_name="catalog_products")
    op.drop_constraint("fk_catalog_products_channel_id", "catalog_products", type_="foreignkey")
    op.drop_column("catalog_products", "channel_id")
