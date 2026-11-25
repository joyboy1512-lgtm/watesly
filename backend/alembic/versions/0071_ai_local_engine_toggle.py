"""Add local_engine_enabled toggle for internal AI."""

import sqlalchemy as sa
from alembic import op

revision = "0071_ai_local_engine_toggle"
down_revision = "0070_ai_auto_reply_on_inbound"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_settings",
        sa.Column(
            "local_engine_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("ai_agent_settings", "local_engine_enabled")
