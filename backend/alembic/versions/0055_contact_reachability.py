"""Add contact reachability fields for campaign audience quality."""
from alembic import op
import sqlalchemy as sa

revision: str = "0055"
down_revision: str | None = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("reachability_status", sa.String(20), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("reachability_reason", sa.String(500), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("delivery_failure_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "contacts",
        sa.Column("last_delivery_failure_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_contacts_account_reachability",
        "contacts",
        ["account_id", "reachability_status"],
    )

    op.execute(
        """
        UPDATE contacts c
        SET
            reachability_status = 'unreachable',
            reachability_reason = LEFT(cr.error_message, 500),
            delivery_failure_count = GREATEST(c.delivery_failure_count, 1),
            last_delivery_failure_at = cr.updated_at
        FROM (
            SELECT DISTINCT ON (contact_id)
                contact_id,
                error_message,
                updated_at
            FROM campaign_recipients
            WHERE status = 'failed'
              AND error_message IS NOT NULL
              AND (
                error_message ILIKE '%healthy ecosystem engagement%'
                OR error_message ILIKE '%not on whatsapp%'
                OR error_message ILIKE '%invalid phone%'
              )
            ORDER BY contact_id, updated_at DESC
        ) cr
        WHERE c.id = cr.contact_id
        """
    )

    op.execute(
        """
        UPDATE contacts c
        SET last_inbound_at = inbound.last_inbound_at
        FROM (
            SELECT contact_id, MAX(created_at) AS last_inbound_at
            FROM messages
            WHERE direction = 'inbound'
              AND contact_id IS NOT NULL
            GROUP BY contact_id
        ) inbound
        WHERE c.id = inbound.contact_id
          AND c.last_inbound_at IS NULL
        """
    )

    op.execute(
        """
        UPDATE contacts
        SET reachability_status = 'reachable'
        WHERE reachability_status IS NULL
          AND last_inbound_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_contacts_account_reachability", table_name="contacts")
    op.drop_column("contacts", "last_inbound_at")
    op.drop_column("contacts", "last_delivery_failure_at")
    op.drop_column("contacts", "delivery_failure_count")
    op.drop_column("contacts", "reachability_reason")
    op.drop_column("contacts", "reachability_status")
