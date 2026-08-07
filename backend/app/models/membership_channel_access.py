from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class MembershipChannelAccess(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "membership_channel_access"
    __table_args__ = (
        UniqueConstraint(
            "membership_id", "channel_id",
            name="uq_membership_channel_access_membership_channel",
        ),
    )

    membership_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("memberships.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("channels.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )