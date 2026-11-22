"""Add AI agent control fields: master switch, encrypted LLM key, base URL, model."""

import sqlalchemy as sa
from alembic import op

revision = "0067_ai_agent_control_panel"
down_revision = "0066_organization_logo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_settings",
        sa.Column("agent_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "ai_agent_settings",
        sa.Column("llm_api_key_encrypted", sa.Text(), nullable=True),
    )
    op.add_column(
        "ai_agent_settings",
        sa.Column("llm_api_base_url", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "ai_agent_settings",
        sa.Column("llm_model", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_agent_settings", "llm_model")
    op.drop_column("ai_agent_settings", "llm_api_base_url")
    op.drop_column("ai_agent_settings", "llm_api_key_encrypted")
    op.drop_column("ai_agent_settings", "agent_enabled")
