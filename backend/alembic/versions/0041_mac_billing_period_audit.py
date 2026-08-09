"""MAC billing period, audit log, and plan limit policy."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_active_contacts",
        sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "monthly_active_contacts",
        sa.Column("billing_period_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "monthly_active_contacts",
        sa.Column("billing_period_end", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "monthly_active_contacts",
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "monthly_active_contacts",
        sa.Column("source_event_id", sa.String(255), nullable=True),
    )
    op.create_foreign_key(
        "fk_mac_organization_id",
        "monthly_active_contacts",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_mac_billing_period_start", "monthly_active_contacts", ["billing_period_start"])
    op.create_index("ix_mac_organization_id", "monthly_active_contacts", ["organization_id"])
    op.create_index("ix_mac_source_event_id", "monthly_active_contacts", ["source_event_id"])

    # Backfill billing period from cycle_month (UTC calendar month bounds)
    op.execute(
        """
        UPDATE monthly_active_contacts
        SET billing_period_start = (cycle_month || '-01')::timestamptz,
            billing_period_end = ((cycle_month || '-01')::date + interval '1 month')::timestamptz,
            last_active_at = first_activity_at
        WHERE billing_period_start IS NULL
        """
    )

    op.alter_column("monthly_active_contacts", "billing_period_start", nullable=False)
    op.alter_column("monthly_active_contacts", "billing_period_end", nullable=False)
    op.alter_column("monthly_active_contacts", "last_active_at", nullable=False)

    op.drop_constraint("uq_mac_account_contact_cycle", "monthly_active_contacts", type_="unique")
    op.create_unique_constraint(
        "uq_mac_account_contact_billing_period",
        "monthly_active_contacts",
        ["account_id", "contact_id", "billing_period_start"],
    )

    op.create_table(
        "mac_activation_audits",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mac_record_id", UUID(as_uuid=True), sa.ForeignKey("monthly_active_contacts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("billing_period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("billing_period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activity_type", sa.String(40), nullable=False),
        sa.Column("activation_source", sa.String(40), nullable=False),
        sa.Column("source_event_id", sa.String(255), nullable=True),
        sa.Column("message_id", UUID(as_uuid=True), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_new_mac", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_mac_audit_account_id", "mac_activation_audits", ["account_id"])
    op.create_index("ix_mac_audit_contact_id", "mac_activation_audits", ["contact_id"])
    op.create_index("ix_mac_audit_created_at", "mac_activation_audits", ["created_at"])
    op.create_index(
        "uq_mac_audit_source_event",
        "mac_activation_audits",
        ["account_id", "source_event_id"],
        unique=True,
        postgresql_where=sa.text("source_event_id IS NOT NULL"),
    )

    op.add_column(
        "plans",
        sa.Column("mac_limit_policy", sa.String(20), nullable=False, server_default="soft"),
    )
    op.add_column(
        "plans",
        sa.Column("overage_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("plans", "overage_enabled")
    op.drop_column("plans", "mac_limit_policy")
    op.drop_table("mac_activation_audits")
    op.drop_constraint("uq_mac_account_contact_billing_period", "monthly_active_contacts", type_="unique")
    op.create_unique_constraint(
        "uq_mac_account_contact_cycle",
        "monthly_active_contacts",
        ["account_id", "contact_id", "cycle_month"],
    )
    op.drop_index("ix_mac_source_event_id", table_name="monthly_active_contacts")
    op.drop_index("ix_mac_organization_id", table_name="monthly_active_contacts")
    op.drop_index("ix_mac_billing_period_start", table_name="monthly_active_contacts")
    op.drop_constraint("fk_mac_organization_id", "monthly_active_contacts", type_="foreignkey")
    op.drop_column("monthly_active_contacts", "source_event_id")
    op.drop_column("monthly_active_contacts", "last_active_at")
    op.drop_column("monthly_active_contacts", "billing_period_end")
    op.drop_column("monthly_active_contacts", "billing_period_start")
    op.drop_column("monthly_active_contacts", "organization_id")
