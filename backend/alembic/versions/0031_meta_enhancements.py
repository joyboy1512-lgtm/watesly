"""Template status detail + campaign body variable mapping."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_templates",
        sa.Column("meta_status_detail", sa.Text(), nullable=True),
    )
    op.add_column(
        "campaigns",
        sa.Column("body_variable_mapping", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("campaigns", "body_variable_mapping")
    op.drop_column("whatsapp_templates", "meta_status_detail")
