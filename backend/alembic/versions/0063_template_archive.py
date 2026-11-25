"""Add archived_at to whatsapp_templates for soft archive."""

import sqlalchemy as sa
from alembic import op

revision = "0063_template_archive"
down_revision = "0062_instagram_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_templates",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_whatsapp_templates_archived_at",
        "whatsapp_templates",
        ["archived_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_whatsapp_templates_archived_at", table_name="whatsapp_templates")
    op.drop_column("whatsapp_templates", "archived_at")
