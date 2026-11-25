"""Per-channel AI ops settings, activity log, and template drafts.

Revision ID: 0072_ai_channel_ops
Revises: 0071_ai_local_engine_toggle
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0072_ai_channel_ops"
down_revision = "0071_ai_local_engine_toggle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_agent_channel_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        # Nullable = inherit account default
        sa.Column("agent_enabled", sa.Boolean(), nullable=True),
        sa.Column("local_engine_enabled", sa.Boolean(), nullable=True),
        sa.Column("llm_enabled", sa.Boolean(), nullable=True),
        sa.Column("auto_kb_on_inbound", sa.Boolean(), nullable=True),
        sa.Column("auto_reply_on_inbound", sa.Boolean(), nullable=True),
        sa.Column("default_mode", sa.String(30), nullable=True),
        sa.Column("tone", sa.String(30), nullable=True),
        sa.Column("language", sa.String(10), nullable=True),
        sa.Column("auto_reply_outside_hours", sa.Boolean(), nullable=True),
        sa.Column("business_hours_json", postgresql.JSONB(), nullable=True),
        sa.Column("outside_hours_message", sa.Text(), nullable=True),
        sa.Column("escalation_keywords", postgresql.JSONB(), nullable=True),
        sa.Column("clarify_max_rounds", sa.Integer(), nullable=True),
        sa.UniqueConstraint("account_id", "channel_id", name="uq_ai_agent_channel_settings_account_channel"),
    )
    op.create_index("ix_ai_agent_channel_settings_account_id", "ai_agent_channel_settings", ["account_id"])
    op.create_index("ix_ai_agent_channel_settings_channel_id", "ai_agent_channel_settings", ["channel_id"])

    op.create_table(
        "ai_activity_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="SET NULL"), nullable=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("source", sa.String(30), nullable=False, server_default="live"),
        sa.Column("outcome", sa.String(40), nullable=False),
        sa.Column("reason_code", sa.String(80), nullable=True),
        sa.Column("reason_text", sa.Text(), nullable=True),
        sa.Column("query_text", sa.Text(), nullable=True),
        sa.Column("suggestion", sa.Text(), nullable=True),
        sa.Column("engine", sa.String(80), nullable=True),
        sa.Column("meta_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_ai_activity_events_account_created", "ai_activity_events", ["account_id", "created_at"])
    op.create_index("ix_ai_activity_events_channel_created", "ai_activity_events", ["channel_id", "created_at"])

    op.create_table(
        "ai_template_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("whatsapp_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("whatsapp_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("topic", sa.Text(), nullable=True),
        sa.Column("angle", sa.String(80), nullable=True),
        sa.Column("draft_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("internal_check_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("meta_status", sa.String(40), nullable=True),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("whatsapp_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_ai_template_drafts_account_channel", "ai_template_drafts", ["account_id", "channel_id"])


def downgrade() -> None:
    op.drop_table("ai_template_drafts")
    op.drop_table("ai_activity_events")
    op.drop_table("ai_agent_channel_settings")
