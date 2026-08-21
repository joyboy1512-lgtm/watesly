"""WhatsApp business profile and catalog cover branding fields."""

from alembic import op
import sqlalchemy as sa

revision = "0058_whatsapp_branding"
down_revision = "0057_account_email_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_accounts",
        sa.Column("profile_image_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("profile_image_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("catalog_cover_image_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("meta_catalog_product_set_id", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("catalog_cover_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_accounts", "catalog_cover_synced_at")
    op.drop_column("whatsapp_accounts", "meta_catalog_product_set_id")
    op.drop_column("whatsapp_accounts", "catalog_cover_image_url")
    op.drop_column("whatsapp_accounts", "profile_image_synced_at")
    op.drop_column("whatsapp_accounts", "profile_image_url")
