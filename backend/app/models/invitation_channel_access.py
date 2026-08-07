from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InvitationChannelAccess(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "invitation_channel_access"
    __table_args__ = (
        UniqueConstraint(
            "invitation_id", "channel_id",
            name="uq_invitation_channel_access_invitation_channel",
        ),
    )

    invitation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("invitations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("channels.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )