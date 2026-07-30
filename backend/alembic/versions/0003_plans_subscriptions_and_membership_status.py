"""Add plans, subscriptions, and membership status."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    membership_status = postgresql.ENUM(
        "ACTIVE", "SUSPENDED",
        name="membership_status",
        create_type=False,
    )
    membership_status.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "memberships",
        sa.Column(
            "status",
            membership_status,
            server_default="ACTIVE",
            nullable=False,
        ),
    )

    op.create_table(
        "plans",
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("monthly_price", sa.Numeric(12, 3), nullable=False),
        sa.Column("yearly_price", sa.Numeric(12, 3), nullable=False),
        sa.Column("max_users", sa.Integer(), nullable=False),
        sa.Column("max_organizations", sa.Integer(), nullable=False),
        sa.Column("max_channels", sa.Integer(), nullable=False),
        sa.Column("trial_days", sa.Integer(), nullable=False),
        sa.Column("allow_multi_organization", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_plans_code", "plans", ["code"], unique=True)

    op.create_table(
        "subscriptions",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("billing_cycle", sa.String(length=20), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id"),
    )
    op.create_index("ix_subscriptions_account_id", "subscriptions", ["account_id"], unique=True)
    op.create_index("ix_subscriptions_plan_id", "subscriptions", ["plan_id"])


def downgrade() -> None:
    op.drop_table("subscriptions")
    op.drop_table("plans")
    op.drop_column("memberships", "status")
    postgresql.ENUM(name="membership_status").drop(op.get_bind(), checkfirst=True)
