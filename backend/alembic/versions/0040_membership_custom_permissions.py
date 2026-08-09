"""Membership custom permissions for per-employee access control."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("custom_permissions", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("memberships", "custom_permissions")
