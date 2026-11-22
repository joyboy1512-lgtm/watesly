"""Add helpful/dismiss feedback counters for internal AI learning."""

import sqlalchemy as sa
from alembic import op

revision = "0068_internal_ai_feedback"
down_revision = "0067_ai_agent_control_panel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_articles",
        sa.Column("helpful_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "knowledge_articles",
        sa.Column("dismiss_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("knowledge_articles", "dismiss_count")
    op.drop_column("knowledge_articles", "helpful_count")
