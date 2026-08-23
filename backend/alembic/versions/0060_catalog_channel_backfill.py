"""Backfill catalog product channel_id from commerce WhatsApp accounts."""

from alembic import op

revision = "0060_catalog_channel_backfill"
down_revision = "0059_catalog_product_channel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Assign products to the sole commerce-enabled WhatsApp channel in the same org.
    # Safe when one branch maps to one phone (e.g. Three Shiny).
    op.execute(
        """
        UPDATE catalog_products AS cp
        SET channel_id = wa.channel_id
        FROM whatsapp_accounts AS wa
        WHERE cp.channel_id IS NULL
          AND cp.organization_id = wa.organization_id
          AND cp.account_id = wa.account_id
          AND wa.commerce_enabled = true
          AND wa.meta_catalog_id IS NOT NULL
          AND btrim(wa.meta_catalog_id) <> ''
          AND (
            SELECT COUNT(*)
            FROM whatsapp_accounts AS wa2
            WHERE wa2.account_id = cp.account_id
              AND wa2.organization_id = cp.organization_id
              AND wa2.commerce_enabled = true
              AND wa2.meta_catalog_id IS NOT NULL
              AND btrim(wa2.meta_catalog_id) <> ''
          ) = 1
        """
    )


def downgrade() -> None:
    pass
