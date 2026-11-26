"""CRM follow-up fields and loss reason.

Revision ID: 0075_crm_followup_loss
Revises: 0074_ai_welcome_message
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0075_crm_followup_loss"
down_revision = "0074_ai_welcome_message"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("deals", sa.Column("loss_reason", sa.String(length=40), nullable=True))
    op.add_column("deals", sa.Column("loss_reason_detail", sa.Text(), nullable=True))
    op.add_column("deals", sa.Column("next_step", sa.String(length=240), nullable=True))
    op.add_column("deals", sa.Column("next_step_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "deals",
        sa.Column("conversation_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_deals_conversation_id",
        "deals",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_deals_next_step_at", "deals", ["next_step_at"])
    op.create_index("ix_deals_loss_reason", "deals", ["loss_reason"])
    # Distinguish unrecorded amount from explicit zero: allow NULL.
    op.alter_column(
        "deals",
        "amount",
        existing_type=sa.Numeric(14, 2),
        nullable=True,
        server_default=None,
    )
    op.add_column("automations", sa.Column("published_graph", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("automations", "published_graph")
    op.execute("UPDATE deals SET amount = 0 WHERE amount IS NULL")
    op.alter_column(
        "deals",
        "amount",
        existing_type=sa.Numeric(14, 2),
        nullable=False,
        server_default="0",
    )
    op.drop_index("ix_deals_loss_reason", table_name="deals")
    op.drop_index("ix_deals_next_step_at", table_name="deals")
    op.drop_constraint("fk_deals_conversation_id", "deals", type_="foreignkey")
    op.drop_column("deals", "conversation_id")
    op.drop_column("deals", "next_step_at")
    op.drop_column("deals", "next_step")
    op.drop_column("deals", "loss_reason_detail")
    op.drop_column("deals", "loss_reason")
