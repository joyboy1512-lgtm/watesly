"""Monthly Active Contact (MAC) billing table."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monthly_active_contacts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cycle_month", sa.String(7), nullable=False),
        sa.Column("trigger_source", sa.String(30), nullable=False),
        sa.Column("first_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "account_id", "channel_id", "contact_id", "cycle_month",
            name="uq_mac_account_channel_contact_cycle",
        ),
    )
    op.create_index("ix_monthly_active_contacts_account_id", "monthly_active_contacts", ["account_id"])
    op.create_index("ix_monthly_active_contacts_channel_id", "monthly_active_contacts", ["channel_id"])
    op.create_index("ix_monthly_active_contacts_contact_id", "monthly_active_contacts", ["contact_id"])
    op.create_index("ix_monthly_active_contacts_cycle_month", "monthly_active_contacts", ["cycle_month"])


def downgrade() -> None:
    op.drop_table("monthly_active_contacts")
