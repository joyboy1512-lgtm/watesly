"""Add MAC (Monthly Active Contacts) limits to plans."""
from alembic import op
import sqlalchemy as sa

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plans",
        sa.Column("included_mac", sa.Integer(), nullable=False, server_default="1000"),
    )
    op.add_column(
        "plans",
        sa.Column(
            "over_mac_price_per_100",
            sa.Numeric(12, 3),
            nullable=False,
            server_default="12",
        ),
    )
    op.execute("UPDATE plans SET included_mac = 100 WHERE code = 'trial'")


def downgrade() -> None:
    op.drop_column("plans", "over_mac_price_per_100")
    op.drop_column("plans", "included_mac")
