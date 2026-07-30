from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TeamMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "team_members"
    __table_args__ = (
        UniqueConstraint("team_id", "membership_id", name="uq_team_members_team_membership"),
    )

    team_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    membership_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("memberships.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
