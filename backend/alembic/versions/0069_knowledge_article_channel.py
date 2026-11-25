"""Scope knowledge articles to a WhatsApp channel."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0069_knowledge_article_channel"
down_revision = "0068_internal_ai_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_articles",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_knowledge_articles_channel_id",
        "knowledge_articles",
        "channels",
        ["channel_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_knowledge_articles_channel_id", "knowledge_articles", ["channel_id"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_articles_channel_id", table_name="knowledge_articles")
    op.drop_constraint("fk_knowledge_articles_channel_id", "knowledge_articles", type_="foreignkey")
    op.drop_column("knowledge_articles", "channel_id")
