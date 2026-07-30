"""Initial accounts, organizations, users, and memberships schema."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    account_status = postgresql.ENUM("TRIAL", "ACTIVE", "SUSPENDED", "CLOSED", name="account_status", create_type=False)
    organization_status = postgresql.ENUM("ACTIVE", "SUSPENDED", name="organization_status", create_type=False)
    user_status = postgresql.ENUM("INVITED", "ACTIVE", "SUSPENDED", name="user_status", create_type=False)
    membership_role = postgresql.ENUM("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER", name="membership_role", create_type=False)
    account_status.create(op.get_bind(), checkfirst=True)
    organization_status.create(op.get_bind(), checkfirst=True)
    user_status.create(op.get_bind(), checkfirst=True)
    membership_role.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "accounts",
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("status", account_status, nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
    )
    op.create_table(
        "users",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("full_name", sa.String(length=160), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("preferred_language", sa.String(length=5), nullable=False),
        sa.Column("is_super_admin", sa.Boolean(), nullable=False),
        sa.Column("status", user_status, nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table(
        "organizations",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("default_language", sa.String(length=5), nullable=False),
        sa.Column("status", organization_status, nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], name="fk_organizations_account_id_accounts", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
        sa.UniqueConstraint("account_id", "slug", name="uq_organizations_account_slug"),
    )
    op.create_index("ix_organizations_account_id", "organizations", ["account_id"], unique=False)
    op.create_table(
        "memberships",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", membership_role, nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], name="fk_memberships_account_id_accounts", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_memberships_user_id_users", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_memberships"),
        sa.UniqueConstraint("account_id", "user_id", name="uq_memberships_account_user"),
    )
    op.create_index("ix_memberships_account_id", "memberships", ["account_id"], unique=False)
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_memberships_user_id", table_name="memberships")
    op.drop_index("ix_memberships_account_id", table_name="memberships")
    op.drop_table("memberships")
    op.drop_index("ix_organizations_account_id", table_name="organizations")
    op.drop_table("organizations")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_table("accounts")
    postgresql.ENUM(name="membership_role").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="user_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="organization_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="account_status").drop(op.get_bind(), checkfirst=True)
