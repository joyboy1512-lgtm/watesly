"""Platform site content (singleton CMS)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_site_config",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("branding_json", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("display_json", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("content_json", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("platform_site_config")
