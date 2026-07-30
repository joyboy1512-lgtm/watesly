"""Production core: account lifecycle, login protection, campaign and automation safety."""
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("failed_login_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("campaigns", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("cancelled_reason", sa.Text(), nullable=True))
    op.add_column("campaigns", sa.Column("max_recipients", sa.Integer(), nullable=False, server_default="1000"))
    op.add_column("campaigns", sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_foreign_key("fk_campaigns_approved_by", "campaigns", "users", ["approved_by_user_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_campaigns_approved_by_user_id", "campaigns", ["approved_by_user_id"])
    op.add_column("automation_runs", sa.Column("step_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("automation_runs", sa.Column("max_steps", sa.Integer(), nullable=False, server_default="200"))
    op.add_column("automation_runs", sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("automation_runs", sa.Column("cancellation_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_automation_runs_deadline", "automation_runs", ["status", "deadline_at"])
    op.create_index("ix_refresh_sessions_user_active", "refresh_sessions", ["user_id", "revoked_at", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_refresh_sessions_user_active", table_name="refresh_sessions")
    op.drop_index("ix_automation_runs_deadline", table_name="automation_runs")
    for name in ["cancellation_requested_at", "deadline_at", "max_steps", "step_count"]:
        op.drop_column("automation_runs", name)
    op.drop_index("ix_campaigns_approved_by_user_id", table_name="campaigns")
    op.drop_constraint("fk_campaigns_approved_by", "campaigns", type_="foreignkey")
    for name in ["requires_approval", "max_recipients", "cancelled_reason", "paused_at", "approved_at", "approved_by_user_id"]:
        op.drop_column("campaigns", name)
    for name in ["password_changed_at", "locked_until", "failed_login_attempts"]:
        op.drop_column("users", name)
