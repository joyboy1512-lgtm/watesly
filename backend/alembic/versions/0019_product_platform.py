"""Product platform features: CRM, inbox productivity, segments, API keys."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("is_starred", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("conversations", sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("conversations", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_conversations_snoozed_until", "conversations", ["snoozed_until"])
    op.create_index("ix_conversations_archived_at", "conversations", ["archived_at"])

    op.add_column("conversation_notes", sa.Column("mentions", postgresql.JSONB(), nullable=True))
    op.add_column("conversation_notes", sa.Column("is_internal", sa.Boolean(), server_default="true", nullable=False))

    op.add_column("quick_replies", sa.Column("category", sa.String(80), nullable=True))
    op.add_column("quick_replies", sa.Column("is_shared", sa.Boolean(), server_default="true", nullable=False))

    op.create_table(
        "conversation_read_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("membership_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unread_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("conversation_id", "membership_id", name="uq_conversation_read_states_conv_member"),
    )
    op.create_index("ix_conversation_read_states_conversation_id", "conversation_read_states", ["conversation_id"])
    op.create_index("ix_conversation_read_states_membership_id", "conversation_read_states", ["membership_id"])

    op.create_table(
        "contact_tags",
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "custom_field_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(40), nullable=False),
        sa.Column("field_key", sa.String(80), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("field_type", sa.String(40), server_default="text", nullable=False),
        sa.Column("options_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("account_id", "entity_type", "field_key", name="uq_custom_field_definitions_account_entity_key"),
    )
    op.create_index("ix_custom_field_definitions_account_id", "custom_field_definitions", ["account_id"])

    op.create_table(
        "custom_field_values",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("definition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("custom_field_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("definition_id", "entity_id", name="uq_custom_field_values_definition_entity"),
    )
    op.create_index("ix_custom_field_values_entity_id", "custom_field_values", ["entity_id"])

    op.create_table(
        "segments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("filter_json", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_segments_account_id", "segments", ["account_id"])

    op.create_table(
        "departments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_departments_account_id", "departments", ["account_id"])

    op.create_table(
        "agent_presence",
        sa.Column("membership_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memberships.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(20), server_default="offline", nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("key_prefix", sa.String(16), nullable=False),
        sa.Column("key_hash", sa.String(128), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_api_keys_account_id", "api_keys", ["account_id"])
    op.create_index("ix_api_keys_key_prefix", "api_keys", ["key_prefix"])

    op.create_table(
        "webhook_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("events", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("secret", sa.String(128), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_webhook_subscriptions_account_id", "webhook_subscriptions", ["account_id"])

    op.create_table(
        "deals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("stage", sa.String(40), server_default="lead", nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("pipeline", sa.String(80), server_default="default", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_deals_account_id", "deals", ["account_id"])

    op.create_table(
        "deal_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("deal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_type", sa.String(40), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_deal_activities_deal_id", "deal_activities", ["deal_id"])

    op.create_table(
        "marketplace_integrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), server_default="available", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.add_column("campaign_recipients", sa.Column("ab_variant", sa.String(1), nullable=True))


def downgrade() -> None:
    op.drop_column("campaign_recipients", "ab_variant")
    op.drop_table("marketplace_integrations")
    op.drop_table("deal_activities")
    op.drop_table("deals")
    op.drop_table("webhook_subscriptions")
    op.drop_table("api_keys")
    op.drop_table("agent_presence")
    op.drop_table("departments")
    op.drop_table("segments")
    op.drop_table("custom_field_values")
    op.drop_table("custom_field_definitions")
    op.drop_table("contact_tags")
    op.drop_table("conversation_read_states")
    op.drop_column("quick_replies", "is_shared")
    op.drop_column("quick_replies", "category")
    op.drop_column("conversation_notes", "is_internal")
    op.drop_column("conversation_notes", "mentions")
    op.drop_index("ix_conversations_archived_at", table_name="conversations")
    op.drop_index("ix_conversations_snoozed_until", table_name="conversations")
    op.drop_column("conversations", "archived_at")
    op.drop_column("conversations", "snoozed_until")
    op.drop_column("conversations", "is_starred")
