"""Add WhatsApp templates and campaigns."""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_templates",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("whatsapp_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meta_template_id", sa.String(length=100), nullable=True),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("language", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("components", sa.JSON(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["whatsapp_account_id"], ["whatsapp_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "whatsapp_account_id", "name", "language",
            name="uq_whatsapp_templates_account_name_language",
        ),
    )
    op.create_index("ix_whatsapp_templates_account_id", "whatsapp_templates", ["account_id"])
    op.create_index("ix_whatsapp_templates_organization_id", "whatsapp_templates", ["organization_id"])
    op.create_index("ix_whatsapp_templates_whatsapp_account_id", "whatsapp_templates", ["whatsapp_account_id"])
    op.create_index("ix_whatsapp_templates_meta_template_id", "whatsapp_templates", ["meta_template_id"])

    op.create_table(
        "campaigns",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("whatsapp_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["whatsapp_account_id"], ["whatsapp_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["whatsapp_templates.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_campaigns_account_id", "campaigns", ["account_id"])
    op.create_index("ix_campaigns_organization_id", "campaigns", ["organization_id"])
    op.create_index("ix_campaigns_whatsapp_account_id", "campaigns", ["whatsapp_account_id"])
    op.create_index("ix_campaigns_template_id", "campaigns", ["template_id"])
    op.create_index("ix_campaigns_created_by_user_id", "campaigns", ["created_by_user_id"])

    op.create_table(
        "campaign_recipients",
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("template_parameters", sa.JSON(), nullable=True),
        sa.Column("external_message_id", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "contact_id", name="uq_campaign_recipients_campaign_contact"),
    )
    op.create_index("ix_campaign_recipients_campaign_id", "campaign_recipients", ["campaign_id"])
    op.create_index("ix_campaign_recipients_contact_id", "campaign_recipients", ["contact_id"])
    op.create_index("ix_campaign_recipients_external_message_id", "campaign_recipients", ["external_message_id"])


def downgrade() -> None:
    op.drop_table("campaign_recipients")
    op.drop_table("campaigns")
    op.drop_table("whatsapp_templates")
