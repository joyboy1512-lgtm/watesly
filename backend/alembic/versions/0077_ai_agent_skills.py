"""Add skills_json to ai_agent_settings.

Revision ID: 0077_ai_agent_skills
Revises: 0076_conversation_whisper
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0077_ai_agent_skills"
down_revision = "0076_conversation_whisper"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_settings",
        sa.Column(
            "skills_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("ai_agent_settings", "skills_json")
