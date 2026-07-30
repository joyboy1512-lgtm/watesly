"""Knowledge agent: usage tracking and per-account AI settings."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_articles",
        sa.Column("usage_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "knowledge_articles",
        sa.Column("language", sa.String(10), server_default="ar", nullable=False),
    )

    op.create_table(
        "ai_agent_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("default_mode", sa.String(30), server_default="kb_first", nullable=False),
        sa.Column("tone", sa.String(30), server_default="friendly", nullable=False),
        sa.Column("language", sa.String(10), server_default="ar", nullable=False),
        sa.Column("llm_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("auto_kb_on_inbound", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("llm_system_prompt", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_agent_settings_account_id", "ai_agent_settings", ["account_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_ai_agent_settings_account_id", table_name="ai_agent_settings")
    op.drop_table("ai_agent_settings")
    op.drop_column("knowledge_articles", "language")
    op.drop_column("knowledge_articles", "usage_count")
