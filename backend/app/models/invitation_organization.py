from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class InvitationOrganization(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "invitation_organizations"
    __table_args__ = (
        UniqueConstraint(
            "invitation_id", "organization_id",
            name="uq_invitation_organizations_invitation_organization",
        ),
    )

    invitation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("invitations.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
