"""Provider-configurable subscription and per-channel Over MAC pricing."""
from alembic import op
import sqlalchemy as sa

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column("included_mac_override", sa.Integer(), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("over_mac_price_per_100_override", sa.Numeric(12, 3), nullable=True),
    )
    op.add_column(
        "channels",
        sa.Column("over_mac_price_per_100", sa.Numeric(12, 3), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("channels", "over_mac_price_per_100")
    op.drop_column("subscriptions", "over_mac_price_per_100_override")
    op.drop_column("subscriptions", "included_mac_override")
