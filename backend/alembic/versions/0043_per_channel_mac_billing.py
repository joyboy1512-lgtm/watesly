"""Per-channel independent MAC billing — dedup and subscription per channel."""
from alembic import op
import sqlalchemy as sa

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("billing_starts_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "channels",
        sa.Column("billing_ends_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "channels",
        sa.Column("billing_cycle", sa.String(length=20), nullable=False, server_default="monthly"),
    )
    op.add_column(
        "channels",
        sa.Column("included_mac", sa.Integer(), nullable=True),
    )

    # Seed channel billing from account subscription (one-time backfill).
    op.execute(
        """
        UPDATE channels c
        SET
            billing_starts_at = s.starts_at,
            billing_ends_at = s.ends_at,
            billing_cycle = s.billing_cycle,
            included_mac = COALESCE(s.included_mac_override, p.included_mac)
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE c.account_id = s.account_id
          AND c.deleted_at IS NULL
        """
    )

    op.drop_constraint(
        "uq_mac_account_contact_billing_period",
        "monthly_active_contacts",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_mac_account_channel_contact_billing_period",
        "monthly_active_contacts",
        ["account_id", "channel_id", "contact_id", "billing_period_start"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_mac_account_channel_contact_billing_period",
        "monthly_active_contacts",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_mac_account_contact_billing_period",
        "monthly_active_contacts",
        ["account_id", "contact_id", "billing_period_start"],
    )
    op.drop_column("channels", "included_mac")
    op.drop_column("channels", "billing_cycle")
    op.drop_column("channels", "billing_ends_at")
    op.drop_column("channels", "billing_starts_at")
