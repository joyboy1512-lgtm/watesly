"""Add auto_reply_on_inbound for WhatsApp AI auto-send."""

import sqlalchemy as sa
from alembic import op

revision = "0070_ai_auto_reply_on_inbound"
down_revision = "0069_knowledge_article_channel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_settings",
        sa.Column(
            "auto_reply_on_inbound",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("ai_agent_settings", "auto_reply_on_inbound")
