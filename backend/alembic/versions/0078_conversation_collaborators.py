"""Add collaborator_membership_ids to conversations.

Revision ID: 0078_conversation_collaborators
Revises: 0077_ai_agent_skills
Create Date: 2026-11-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0078_conversation_collaborators"
down_revision = "0077_ai_agent_skills"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "collaborator_membership_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("conversations", "collaborator_membership_ids")
