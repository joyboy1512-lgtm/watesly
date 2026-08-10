"""Add archived_at to campaigns."""
from alembic import op
import sqlalchemy as sa

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_campaigns_archived_at", "campaigns", ["archived_at"])


def downgrade() -> None:
    op.drop_index("ix_campaigns_archived_at", table_name="campaigns")
    op.drop_column("campaigns", "archived_at")
