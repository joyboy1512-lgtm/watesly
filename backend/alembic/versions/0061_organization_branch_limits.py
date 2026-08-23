"""Add per-branch user and channel limits on organizations."""

import sqlalchemy as sa
from alembic import op

revision = "0061_organization_branch_limits"
down_revision = "0060_catalog_channel_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("max_users", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "organizations",
        sa.Column("max_channels", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("organizations", "max_users", server_default=None)
    op.alter_column("organizations", "max_channels", server_default=None)


def downgrade() -> None:
    op.drop_column("organizations", "max_channels")
    op.drop_column("organizations", "max_users")
