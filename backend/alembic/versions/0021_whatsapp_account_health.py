"""WhatsApp account health: quality rating and messaging tier."""
from alembic import op
import sqlalchemy as sa

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_accounts",
        sa.Column("connection_method", sa.String(20), server_default="manual", nullable=False),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("quality_rating", sa.String(20), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("messaging_limit_tier", sa.String(30), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("messaging_limit", sa.Integer(), nullable=True),
    )
    op.add_column(
        "whatsapp_accounts",
        sa.Column("health_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_accounts", "health_synced_at")
    op.drop_column("whatsapp_accounts", "messaging_limit")
    op.drop_column("whatsapp_accounts", "messaging_limit_tier")
    op.drop_column("whatsapp_accounts", "quality_rating")
    op.drop_column("whatsapp_accounts", "connection_method")
