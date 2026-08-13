"""whatsapp meta health fields

Revision ID: 0056_whatsapp_meta_health
Revises: 0055_contact_reachability
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa

revision = "0056_whatsapp_meta_health"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("whatsapp_accounts", sa.Column("meta_phone_status", sa.String(30), nullable=True))
    op.add_column("whatsapp_accounts", sa.Column("meta_name_status", sa.String(30), nullable=True))
    op.add_column("whatsapp_accounts", sa.Column("meta_can_send_message", sa.String(30), nullable=True))
    op.add_column("whatsapp_accounts", sa.Column("meta_account_review_status", sa.String(30), nullable=True))
    op.add_column("whatsapp_accounts", sa.Column("meta_status_message", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("whatsapp_accounts", "meta_status_message")
    op.drop_column("whatsapp_accounts", "meta_account_review_status")
    op.drop_column("whatsapp_accounts", "meta_can_send_message")
    op.drop_column("whatsapp_accounts", "meta_name_status")
    op.drop_column("whatsapp_accounts", "meta_phone_status")
