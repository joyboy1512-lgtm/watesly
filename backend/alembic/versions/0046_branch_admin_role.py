"""Add branch_admin membership role."""

from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'branch_admin'")


def downgrade() -> None:
    pass
