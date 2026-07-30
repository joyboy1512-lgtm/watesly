"""Add WhatsApp accounts, webhook events, and messages."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_accounts",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("waba_id", sa.String(length=80), nullable=False),
        sa.Column("phone_number_id", sa.String(length=80), nullable=False),
        sa.Column("display_phone_number", sa.String(length=40), nullable=False),
        sa.Column("verified_name", sa.String(length=160), nullable=True),
        sa.Column("access_token_encrypted", sa.String(length=1024), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_id"),
        sa.UniqueConstraint("phone_number_id", name="uq_whatsapp_accounts_phone_number_id"),
    )
    op.create_index("ix_whatsapp_accounts_account_id", "whatsapp_accounts", ["account_id"])
    op.create_index("ix_whatsapp_accounts_organization_id", "whatsapp_accounts", ["organization_id"])
    op.create_index("ix_whatsapp_accounts_channel_id", "whatsapp_accounts", ["channel_id"], unique=True)
    op.create_index("ix_whatsapp_accounts_waba_id", "whatsapp_accounts", ["waba_id"])
    op.create_index("ix_whatsapp_accounts_phone_number_id", "whatsapp_accounts", ["phone_number_id"])

    op.create_table(
        "webhook_events",
        sa.Column("provider", sa.String(length=30), nullable=False),
        sa.Column("external_event_key", sa.String(length=255), nullable=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webhook_events_provider", "webhook_events", ["provider"])
    op.create_index("ix_webhook_events_external_event_key", "webhook_events", ["external_event_key"])
    op.create_index("ix_webhook_events_account_id", "webhook_events", ["account_id"])
    op.create_index("ix_webhook_events_channel_id", "webhook_events", ["channel_id"])
    op.create_index("ix_webhook_events_event_type", "webhook_events", ["event_type"])

    op.create_table(
        "messages",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_message_id", sa.String(length=255), nullable=True),
        sa.Column("direction", sa.String(length=20), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("from_address", sa.String(length=80), nullable=False),
        sa.Column("to_address", sa.String(length=80), nullable=False),
        sa.Column("text_body", sa.Text(), nullable=True),
        sa.Column("provider_payload", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_message_id"),
    )
    op.create_index("ix_messages_account_id", "messages", ["account_id"])
    op.create_index("ix_messages_organization_id", "messages", ["organization_id"])
    op.create_index("ix_messages_channel_id", "messages", ["channel_id"])
    op.create_index("ix_messages_external_message_id", "messages", ["external_message_id"], unique=True)
    op.create_index("ix_messages_from_address", "messages", ["from_address"])
    op.create_index("ix_messages_to_address", "messages", ["to_address"])


def downgrade() -> None:
    op.drop_table("messages")
    op.drop_table("webhook_events")
    op.drop_table("whatsapp_accounts")
