"""Add marketing_opt_in column to contacts."""
from alembic import op
import sqlalchemy as sa

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("marketing_opt_in", sa.Boolean(), server_default="true", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("contacts", "marketing_opt_in")
