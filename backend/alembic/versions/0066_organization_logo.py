"""Add logo_url to organizations for branch branding on invoices."""

import sqlalchemy as sa
from alembic import op

revision = "0066_organization_logo"
down_revision = "0065_composer_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("logo_url", sa.String(length=2048), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organizations", "logo_url")
