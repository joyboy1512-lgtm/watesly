"""Add messenger_accounts for Meta Messenger Messaging."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0079_messenger_accounts"
down_revision = "0078_conversation_collaborators"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "messenger_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_id", sa.String(80), nullable=False),
        sa.Column("page_name", sa.String(160), nullable=True),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("webhook_subscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta_status_message", sa.Text(), nullable=True),
    )
    op.create_index("ix_messenger_accounts_account_id", "messenger_accounts", ["account_id"])
    op.create_index("ix_messenger_accounts_organization_id", "messenger_accounts", ["organization_id"])
    op.create_index("ix_messenger_accounts_channel_id", "messenger_accounts", ["channel_id"], unique=True)
    op.create_index("ix_messenger_accounts_page_id", "messenger_accounts", ["page_id"])
    op.create_unique_constraint("uq_messenger_accounts_page_id", "messenger_accounts", ["page_id"])


def downgrade() -> None:
    op.drop_constraint("uq_messenger_accounts_page_id", "messenger_accounts", type_="unique")
    op.drop_index("ix_messenger_accounts_page_id", table_name="messenger_accounts")
    op.drop_index("ix_messenger_accounts_channel_id", table_name="messenger_accounts")
    op.drop_index("ix_messenger_accounts_organization_id", table_name="messenger_accounts")
    op.drop_index("ix_messenger_accounts_account_id", table_name="messenger_accounts")
    op.drop_table("messenger_accounts")
