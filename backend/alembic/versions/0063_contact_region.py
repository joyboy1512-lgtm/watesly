"""Add region (المنطقة) column to contacts."""

import sqlalchemy as sa
from alembic import op

revision = "0063_contact_region"
down_revision = "0062_instagram_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("contacts", sa.Column("region", sa.String(length=120), nullable=True))
    op.create_index("ix_contacts_region", "contacts", ["region"])


def downgrade() -> None:
    op.drop_index("ix_contacts_region", table_name="contacts")
    op.drop_column("contacts", "region")
