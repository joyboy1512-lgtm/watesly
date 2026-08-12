"""Add BRANCH_ADMIN uppercase value to membership_role enum.

SQLAlchemy persists Python enum member names (BRANCH_ADMIN) while migration 0046
added lowercase branch_admin only, causing 500 errors when assigning the role.
"""

from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'BRANCH_ADMIN'")


def downgrade() -> None:
    pass
