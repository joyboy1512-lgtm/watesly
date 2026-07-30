"""Add contacts, conversations, events, and message links."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "contacts",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_address", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("language", sa.String(length=10), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "channel_id", "external_address",
            name="uq_contacts_org_channel_address",
        ),
    )
    op.create_index("ix_contacts_account_id", "contacts", ["account_id"])
    op.create_index("ix_contacts_organization_id", "contacts", ["organization_id"])
    op.create_index("ix_contacts_channel_id", "contacts", ["channel_id"])
    op.create_index("ix_contacts_external_address", "contacts", ["external_address"])

    op.create_table(
        "conversations",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_membership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("priority", sa.String(length=20), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_membership_id"], ["memberships.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "contact_id", "channel_id", "status",
            name="uq_conversations_contact_channel_status",
        ),
    )
    op.create_index("ix_conversations_account_id", "conversations", ["account_id"])
    op.create_index("ix_conversations_organization_id", "conversations", ["organization_id"])
    op.create_index("ix_conversations_channel_id", "conversations", ["channel_id"])
    op.create_index("ix_conversations_contact_id", "conversations", ["contact_id"])
    op.create_index("ix_conversations_assigned_membership_id", "conversations", ["assigned_membership_id"])

    op.create_table(
        "conversation_events",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_conversation_events_conversation_id", "conversation_events", ["conversation_id"])
    op.create_index("ix_conversation_events_actor_user_id", "conversation_events", ["actor_user_id"])
    op.create_index("ix_conversation_events_event_type", "conversation_events", ["event_type"])

    op.add_column("messages", sa.Column("contact_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("messages", sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_messages_contact_id_contacts",
        "messages", "contacts",
        ["contact_id"], ["id"], ondelete="SET NULL"
    )
    op.create_foreign_key(
        "fk_messages_conversation_id_conversations",
        "messages", "conversations",
        ["conversation_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_messages_contact_id", "messages", ["contact_id"])
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_messages_conversation_id", table_name="messages")
    op.drop_index("ix_messages_contact_id", table_name="messages")
    op.drop_constraint("fk_messages_conversation_id_conversations", "messages", type_="foreignkey")
    op.drop_constraint("fk_messages_contact_id_contacts", "messages", type_="foreignkey")
    op.drop_column("messages", "conversation_id")
    op.drop_column("messages", "contact_id")
    op.drop_table("conversation_events")
    op.drop_table("conversations")
    op.drop_table("contacts")
