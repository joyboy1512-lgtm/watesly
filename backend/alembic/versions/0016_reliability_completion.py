"""Reliability completion: durable outbox locking."""
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("outbox_events", sa.Column("lock_owner", sa.String(120), nullable=True))
    op.add_column("outbox_events", sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="10"))
    op.create_index("ix_outbox_processing_lock", "outbox_events", ["status", "locked_at"])


def downgrade() -> None:
    op.drop_index("ix_outbox_processing_lock", table_name="outbox_events")
    op.drop_column("outbox_events", "max_attempts")
    op.drop_column("outbox_events", "lock_owner")
