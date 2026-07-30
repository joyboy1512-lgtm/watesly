"""Stable foundation: soft delete, JSONB, indexes, outbox and idempotency."""
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("contacts", "conversations", "channels"):
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"ix_{table}_deleted_at", table, ["deleted_at"])

    op.alter_column("messages", "provider_payload", type_=postgresql.JSONB(), postgresql_using="provider_payload::jsonb")
    op.alter_column("webhook_events", "payload", type_=postgresql.JSONB(), postgresql_using="payload::jsonb")

    op.create_index("ix_messages_account_created", "messages", ["account_id", "created_at"])
    op.create_index("ix_messages_conversation_created", "messages", ["conversation_id", "created_at"])
    op.create_index("ix_messages_status_direction", "messages", ["status", "direction"])
    op.create_index("ix_conversations_account_last_message", "conversations", ["account_id", "last_message_at"])
    op.create_index("ix_contacts_account_address", "contacts", ["account_id", "external_address"])

    op.create_table(
        "outbox_events",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(120), nullable=False),
        sa.Column("aggregate_type", sa.String(80), nullable=False),
        sa.Column("aggregate_id", sa.String(120), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_outbox_events_account_id", "outbox_events", ["account_id"])
    op.create_index("ix_outbox_events_status_available", "outbox_events", ["status", "available_at"])

    op.create_table(
        "idempotency_records",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("command_name", sa.String(120), nullable=False),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("response_payload", postgresql.JSONB(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "command_name", "idempotency_key", name="uq_idempotency_scope"),
    )
    op.create_index("ix_idempotency_records_account_id", "idempotency_records", ["account_id"])
    op.create_index("ix_idempotency_records_expires_at", "idempotency_records", ["expires_at"])


def downgrade() -> None:
    op.drop_table("idempotency_records")
    op.drop_table("outbox_events")
    op.drop_index("ix_contacts_account_address", table_name="contacts")
    op.drop_index("ix_conversations_account_last_message", table_name="conversations")
    op.drop_index("ix_messages_status_direction", table_name="messages")
    op.drop_index("ix_messages_conversation_created", table_name="messages")
    op.drop_index("ix_messages_account_created", table_name="messages")
    op.alter_column("webhook_events", "payload", type_=sa.JSON(), postgresql_using="payload::json")
    op.alter_column("messages", "provider_payload", type_=sa.JSON(), postgresql_using="provider_payload::json")
    for table in ("channels", "conversations", "contacts"):
        op.drop_index(f"ix_{table}_deleted_at", table_name=table)
        op.drop_column(table, "deleted_at")
