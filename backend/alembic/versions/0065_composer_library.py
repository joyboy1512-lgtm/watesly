"""Add branch-scoped composer button/list template library."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0065_composer_library"
down_revision = "0064_custom_inboxes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "composer_button_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("titles", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", "name", name="uq_composer_button_templates_org_name"),
    )
    op.create_index("ix_composer_button_templates_account_id", "composer_button_templates", ["account_id"])
    op.create_index(
        "ix_composer_button_templates_organization_id", "composer_button_templates", ["organization_id"]
    )
    op.create_index(
        "ix_composer_button_templates_created_by_user_id",
        "composer_button_templates",
        ["created_by_user_id"],
    )

    op.create_table(
        "composer_list_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("button_text", sa.String(length=20), nullable=False),
        sa.Column(
            "sections_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", "name", name="uq_composer_list_templates_org_name"),
    )
    op.create_index("ix_composer_list_templates_account_id", "composer_list_templates", ["account_id"])
    op.create_index(
        "ix_composer_list_templates_organization_id", "composer_list_templates", ["organization_id"]
    )
    op.create_index(
        "ix_composer_list_templates_created_by_user_id",
        "composer_list_templates",
        ["created_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_composer_list_templates_created_by_user_id", table_name="composer_list_templates")
    op.drop_index("ix_composer_list_templates_organization_id", table_name="composer_list_templates")
    op.drop_index("ix_composer_list_templates_account_id", table_name="composer_list_templates")
    op.drop_table("composer_list_templates")
    op.drop_index("ix_composer_button_templates_created_by_user_id", table_name="composer_button_templates")
    op.drop_index("ix_composer_button_templates_organization_id", table_name="composer_button_templates")
    op.drop_index("ix_composer_button_templates_account_id", table_name="composer_button_templates")
    op.drop_table("composer_button_templates")
