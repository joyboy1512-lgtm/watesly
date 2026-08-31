"""Add instagram_accounts for Meta Instagram Messaging."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0062_instagram_accounts"
down_revision = "0061_organization_branch_limits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "instagram_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_id", sa.String(80), nullable=False),
        sa.Column("ig_user_id", sa.String(80), nullable=False),
        sa.Column("username", sa.String(160), nullable=True),
        sa.Column("page_name", sa.String(160), nullable=True),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("webhook_subscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta_status_message", sa.Text(), nullable=True),
    )
    op.create_index("ix_instagram_accounts_account_id", "instagram_accounts", ["account_id"])
    op.create_index("ix_instagram_accounts_organization_id", "instagram_accounts", ["organization_id"])
    op.create_index("ix_instagram_accounts_channel_id", "instagram_accounts", ["channel_id"], unique=True)
    op.create_index("ix_instagram_accounts_page_id", "instagram_accounts", ["page_id"])
    op.create_index("ix_instagram_accounts_ig_user_id", "instagram_accounts", ["ig_user_id"])
    op.create_unique_constraint("uq_instagram_accounts_ig_user_id", "instagram_accounts", ["ig_user_id"])
    op.create_unique_constraint("uq_instagram_accounts_page_id", "instagram_accounts", ["page_id"])


def downgrade() -> None:
    op.drop_constraint("uq_instagram_accounts_page_id", "instagram_accounts", type_="unique")
    op.drop_constraint("uq_instagram_accounts_ig_user_id", "instagram_accounts", type_="unique")
    op.drop_index("ix_instagram_accounts_ig_user_id", table_name="instagram_accounts")
    op.drop_index("ix_instagram_accounts_page_id", table_name="instagram_accounts")
    op.drop_index("ix_instagram_accounts_channel_id", table_name="instagram_accounts")
    op.drop_index("ix_instagram_accounts_organization_id", table_name="instagram_accounts")
    op.drop_index("ix_instagram_accounts_account_id", table_name="instagram_accounts")
    op.drop_table("instagram_accounts")
