"""Add dedicated LLM image model setting.

Revision ID: 0073_ai_image_model
Revises: 0072_ai_channel_ops
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0073_ai_image_model"
down_revision = "0072_ai_channel_ops"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_settings",
        sa.Column("llm_image_model", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_agent_settings", "llm_image_model")
