"""Membership and invitation channel access."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "membership_channel_access",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("membership_id", UUID(as_uuid=True), sa.ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("membership_id", "channel_id", name="uq_membership_channel_access_membership_channel"),
    )
    op.create_index("ix_membership_channel_access_membership_id", "membership_channel_access", ["membership_id"])
    op.create_index("ix_membership_channel_access_channel_id", "membership_channel_access", ["channel_id"])

    op.create_table(
        "invitation_channel_access",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("invitation_id", UUID(as_uuid=True), sa.ForeignKey("invitations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("invitation_id", "channel_id", name="uq_invitation_channel_access_invitation_channel"),
    )
    op.create_index("ix_invitation_channel_access_invitation_id", "invitation_channel_access", ["invitation_id"])
    op.create_index("ix_invitation_channel_access_channel_id", "invitation_channel_access", ["channel_id"])


def downgrade() -> None:
    op.drop_table("invitation_channel_access")
    op.drop_table("membership_channel_access")
