"""Conversation whisper notes for manager coaching.

Revision ID: 0076_conversation_whisper
Revises: 0075_crm_followup_loss
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0076_conversation_whisper"
down_revision = "0075_crm_followup_loss"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_notes",
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="note"),
    )
    op.create_index("ix_conversation_notes_kind", "conversation_notes", ["kind"])


def downgrade() -> None:
    op.drop_index("ix_conversation_notes_kind", table_name="conversation_notes")
    op.drop_column("conversation_notes", "kind")
