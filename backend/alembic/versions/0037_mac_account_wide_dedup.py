"""MAC dedup per account contact cycle (not per channel)."""
from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep earliest activity row per account + contact + cycle.
    op.execute(
        """
        DELETE FROM monthly_active_contacts a
        USING monthly_active_contacts b
        WHERE a.account_id = b.account_id
          AND a.contact_id = b.contact_id
          AND a.cycle_month = b.cycle_month
          AND (
            a.first_activity_at > b.first_activity_at
            OR (a.first_activity_at = b.first_activity_at AND a.id > b.id)
          )
        """
    )
    op.drop_constraint(
        "uq_mac_account_channel_contact_cycle",
        "monthly_active_contacts",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_mac_account_contact_cycle",
        "monthly_active_contacts",
        ["account_id", "contact_id", "cycle_month"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_mac_account_contact_cycle",
        "monthly_active_contacts",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_mac_account_channel_contact_cycle",
        "monthly_active_contacts",
        ["account_id", "channel_id", "contact_id", "cycle_month"],
    )
