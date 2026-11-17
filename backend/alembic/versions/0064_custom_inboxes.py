"""Add custom inboxes for supervisor/agent saved filters."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0064_custom_inboxes"
down_revision = "0063_contact_region"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_inboxes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_by_membership_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("filters_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_custom_inboxes_account_id", "custom_inboxes", ["account_id"])
    op.create_index("ix_custom_inboxes_organization_id", "custom_inboxes", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_inboxes_organization_id", table_name="custom_inboxes")
    op.drop_index("ix_custom_inboxes_account_id", table_name="custom_inboxes")
    op.drop_table("custom_inboxes")
