"""Watesly power features — lifecycle, AI hours, CTWA, feature flags."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("lifecycle_stage", sa.String(30), nullable=False, server_default="lead"),
    )
    op.add_column(
        "contacts",
        sa.Column("referral_json", JSONB, nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("utm_source", sa.String(120), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("utm_campaign", sa.String(160), nullable=True),
    )
    op.add_column(
        "accounts",
        sa.Column("feature_flags", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "ai_agent_settings",
        sa.Column("auto_reply_outside_hours", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "ai_agent_settings",
        sa.Column("business_hours_json", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "ai_agent_settings",
        sa.Column("outside_hours_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("sla_deadline_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("sla_breached_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "sla_breached_at")
    op.drop_column("conversations", "sla_deadline_at")
    op.drop_column("ai_agent_settings", "outside_hours_message")
    op.drop_column("ai_agent_settings", "business_hours_json")
    op.drop_column("ai_agent_settings", "auto_reply_outside_hours")
    op.drop_column("accounts", "feature_flags")
    op.drop_column("contacts", "utm_campaign")
    op.drop_column("contacts", "utm_source")
    op.drop_column("contacts", "referral_json")
    op.drop_column("contacts", "lifecycle_stage")
