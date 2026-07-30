"""Add core engine sprint one models."""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "resource_records",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resource_type", sa.String(length=80), nullable=False),
        sa.Column("resource_id", sa.String(length=120), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "resource_type", "resource_id", name="uq_resource_records_account_type_id"),
    )
    op.create_index("ix_resource_records_account_id", "resource_records", ["account_id"])
    op.create_index("ix_resource_records_resource_type", "resource_records", ["resource_type"])
    op.create_index("ix_resource_records_resource_id", "resource_records", ["resource_id"])
    op.create_index("ix_resource_records_owner_user_id", "resource_records", ["owner_user_id"])

    op.create_table(
        "scheduled_jobs",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", sa.String(length=100), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scheduled_jobs_account_id", "scheduled_jobs", ["account_id"])
    op.create_index("ix_scheduled_jobs_job_type", "scheduled_jobs", ["job_type"])
    op.create_index("ix_scheduled_jobs_run_at", "scheduled_jobs", ["run_at"])
    op.create_index("ix_scheduled_jobs_status", "scheduled_jobs", ["status"])

    op.create_table(
        "integration_secrets",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("encrypted_value", sa.String(length=4096), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "name", name="uq_integration_secrets_account_name"),
    )
    op.create_index("ix_integration_secrets_account_id", "integration_secrets", ["account_id"])

    op.create_table(
        "module_health",
        sa.Column("module_name", sa.String(length=100), nullable=False),
        sa.Column("instance_id", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("module_name", "instance_id", name="uq_module_health_name_instance"),
    )
    op.create_index("ix_module_health_module_name", "module_health", ["module_name"])
    op.create_index("ix_module_health_instance_id", "module_health", ["instance_id"])
    op.create_index("ix_module_health_status", "module_health", ["status"])
    op.create_index("ix_module_health_heartbeat_at", "module_health", ["heartbeat_at"])


def downgrade() -> None:
    op.drop_table("module_health")
    op.drop_table("integration_secrets")
    op.drop_table("scheduled_jobs")
    op.drop_table("resource_records")
