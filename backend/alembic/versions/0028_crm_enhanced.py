"""Enhance CRM deals with assignment, org, and metadata."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("deals", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("deals", sa.Column("currency", sa.String(length=8), server_default="KWD", nullable=False))
    op.add_column("deals", sa.Column("expected_close_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("deals", sa.Column("probability", sa.Integer(), server_default="0", nullable=False))
    op.add_column("deals", sa.Column("source", sa.String(length=40), nullable=True))
    op.add_column(
        "deals",
        sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "deals",
        sa.Column(
            "assigned_membership_id",
            UUID(as_uuid=True),
            sa.ForeignKey("memberships.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_deals_organization_id", "deals", ["organization_id"])
    op.create_index("ix_deals_assigned_membership_id", "deals", ["assigned_membership_id"])


def downgrade() -> None:
    op.drop_index("ix_deals_assigned_membership_id", table_name="deals")
    op.drop_index("ix_deals_organization_id", table_name="deals")
    op.drop_column("deals", "assigned_membership_id")
    op.drop_column("deals", "organization_id")
    op.drop_column("deals", "source")
    op.drop_column("deals", "probability")
    op.drop_column("deals", "expected_close_date")
    op.drop_column("deals", "currency")
    op.drop_column("deals", "description")
