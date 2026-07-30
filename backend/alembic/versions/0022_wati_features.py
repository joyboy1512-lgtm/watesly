"""Knowledge base, tracked links, CSAT."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_articles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("category", sa.String(80), server_default="general", nullable=False),
        sa.Column("keywords", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_knowledge_articles_account_id", "knowledge_articles", ["account_id"])

    op.create_table(
        "tracked_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("slug", sa.String(32), nullable=False),
        sa.Column("phone_number", sa.String(40), nullable=False),
        sa.Column("prefill_message", sa.Text(), nullable=True),
        sa.Column("click_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("account_id", "slug", name="uq_tracked_links_account_slug"),
    )
    op.create_index("ix_tracked_links_slug", "tracked_links", ["slug"], unique=True)

    op.create_table(
        "link_clicks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tracked_link_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tracked_links.id", ondelete="CASCADE"), nullable=False),
        sa.Column("referrer", sa.String(500), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_link_clicks_tracked_link_id", "link_clicks", ["tracked_link_id"])

    op.create_table(
        "conversation_ratings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("source", sa.String(20), server_default="agent", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("conversation_id", name="uq_conversation_ratings_conversation"),
    )

    op.add_column(
        "contacts",
        sa.Column("source_campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("source_tracked_link_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tracked_links.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("contacts", "source_tracked_link_id")
    op.drop_column("contacts", "source_campaign_id")
    op.drop_table("conversation_ratings")
    op.drop_table("link_clicks")
    op.drop_table("tracked_links")
    op.drop_table("knowledge_articles")
