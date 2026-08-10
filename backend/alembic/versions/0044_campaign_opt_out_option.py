"""Add include_opt_out_option flag to campaigns."""
from alembic import op
import sqlalchemy as sa

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("include_opt_out_option", sa.Boolean(), server_default="true", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("campaigns", "include_opt_out_option")
