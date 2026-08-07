"""Growth phases A–C — follow-up campaigns, ecommerce connections, order templates."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("parent_campaign_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "campaigns",
        sa.Column("follow_up_type", sa.String(40), nullable=True),
    )
    op.create_foreign_key(
        "fk_campaigns_parent_campaign_id",
        "campaigns",
        "campaigns",
        ["parent_campaign_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_campaigns_parent_campaign_id", "campaigns", ["parent_campaign_id"])

    op.create_table(
        "ecommerce_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("shop_label", sa.String(120), nullable=False),
        sa.Column("shop_url", sa.String(500), nullable=False),
        sa.Column("access_token_encrypted", sa.Text(), nullable=True),
        sa.Column("webhook_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("settings_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_ecommerce_connections_account_id", "ecommerce_connections", ["account_id"])

    op.create_table(
        "order_message_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "ecommerce_connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("ecommerce_connections.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("template_id", UUID(as_uuid=True), sa.ForeignKey("whatsapp_templates.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("whatsapp_account_id", UUID(as_uuid=True), sa.ForeignKey("whatsapp_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("variable_mapping", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_order_message_templates_account_id", "order_message_templates", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_order_message_templates_account_id", table_name="order_message_templates")
    op.drop_table("order_message_templates")
    op.drop_index("ix_ecommerce_connections_account_id", table_name="ecommerce_connections")
    op.drop_table("ecommerce_connections")
    op.drop_index("ix_campaigns_parent_campaign_id", table_name="campaigns")
    op.drop_constraint("fk_campaigns_parent_campaign_id", "campaigns", type_="foreignkey")
    op.drop_column("campaigns", "follow_up_type")
    op.drop_column("campaigns", "parent_campaign_id")
