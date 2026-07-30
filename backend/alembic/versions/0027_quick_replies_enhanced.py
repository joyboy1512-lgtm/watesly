"""Enhance quick_replies with usage, sorting, tags, and tone."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("quick_replies", sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False))
    op.add_column("quick_replies", sa.Column("usage_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column("quick_replies", sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("quick_replies", sa.Column("tags", sa.String(length=500), nullable=True))
    op.add_column("quick_replies", sa.Column("tone_variant", sa.String(length=20), nullable=True))
    op.add_column(
        "quick_replies",
        sa.Column("channel_id", UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_quick_replies_channel_id", "quick_replies", ["channel_id"])


def downgrade() -> None:
    op.drop_index("ix_quick_replies_channel_id", table_name="quick_replies")
    op.drop_column("quick_replies", "channel_id")
    op.drop_column("quick_replies", "tone_variant")
    op.drop_column("quick_replies", "tags")
    op.drop_column("quick_replies", "is_active")
    op.drop_column("quick_replies", "usage_count")
    op.drop_column("quick_replies", "sort_order")
