"""Welcome message settings for first inbound reply.

Revision ID: 0074_ai_welcome_message
Revises: 0073_ai_image_model
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0074_ai_welcome_message"
down_revision = "0073_ai_image_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_settings",
        sa.Column("welcome_message_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("ai_agent_settings", sa.Column("welcome_message", sa.Text(), nullable=True))
    op.add_column(
        "ai_agent_channel_settings",
        sa.Column("welcome_message_enabled", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "ai_agent_channel_settings",
        sa.Column("welcome_message", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_agent_channel_settings", "welcome_message")
    op.drop_column("ai_agent_channel_settings", "welcome_message_enabled")
    op.drop_column("ai_agent_settings", "welcome_message")
    op.drop_column("ai_agent_settings", "welcome_message_enabled")
