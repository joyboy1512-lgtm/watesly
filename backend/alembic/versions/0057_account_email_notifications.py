"""Account email notification settings."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0057_account_email_notifications"
down_revision = "0056_whatsapp_meta_health"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("notification_emails", JSONB, nullable=False, server_default="[]"),
    )
    op.add_column(
        "accounts",
        sa.Column("catalog_order_emails", JSONB, nullable=False, server_default="[]"),
    )
    op.add_column(
        "accounts",
        sa.Column(
            "email_notifications_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("accounts", "email_notifications_enabled")
    op.drop_column("accounts", "catalog_order_emails")
    op.drop_column("accounts", "notification_emails")
