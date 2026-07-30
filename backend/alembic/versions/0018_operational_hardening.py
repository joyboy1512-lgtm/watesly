"""Operational hardening for campaign delivery, sessions and files."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision: str = "0018"
down_revision: str | None = "0017"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("campaigns",sa.Column("execution_token",postgresql.UUID(as_uuid=True),nullable=True)); op.create_index("ix_campaigns_execution_token","campaigns",["execution_token"],unique=True)
    op.add_column("campaigns",sa.Column("active_task_id",sa.String(255),nullable=True)); op.create_index("ix_campaigns_active_task_id","campaigns",["active_task_id"])
    op.add_column("campaigns",sa.Column("last_heartbeat_at",sa.DateTime(timezone=True),nullable=True))
    op.add_column("campaign_recipients",sa.Column("delivery_key",sa.String(160),nullable=True)); op.create_index("ix_campaign_recipients_delivery_key","campaign_recipients",["delivery_key"],unique=True)
    op.add_column("campaign_recipients",sa.Column("sending_started_at",sa.DateTime(timezone=True),nullable=True)); op.create_index("ix_campaign_recipients_sending_started_at","campaign_recipients",["sending_started_at"])
    op.add_column("campaign_recipients",sa.Column("last_attempt_at",sa.DateTime(timezone=True),nullable=True))
    op.add_column("refresh_sessions",sa.Column("family_id",postgresql.UUID(as_uuid=True),nullable=True)); op.execute("UPDATE refresh_sessions SET family_id=id WHERE family_id IS NULL"); op.alter_column("refresh_sessions","family_id",nullable=False); op.create_index("ix_refresh_sessions_family_id","refresh_sessions",["family_id"])
    op.add_column("refresh_sessions",sa.Column("replaced_by_session_id",postgresql.UUID(as_uuid=True),nullable=True)); op.create_foreign_key("fk_refresh_sessions_replaced_by_session_id_refresh_sessions","refresh_sessions","refresh_sessions",["replaced_by_session_id"],["id"],ondelete="SET NULL")
    op.add_column("refresh_sessions",sa.Column("reuse_detected_at",sa.DateTime(timezone=True),nullable=True))
    op.add_column("uploaded_files",sa.Column("scan_status",sa.String(30),server_default="available",nullable=False)); op.create_index("ix_uploaded_files_scan_status","uploaded_files",["scan_status"])
    op.add_column("uploaded_files",sa.Column("deleted_at",sa.DateTime(timezone=True),nullable=True)); op.create_index("ix_uploaded_files_deleted_at","uploaded_files",["deleted_at"])
    op.add_column("uploaded_files",sa.Column("retention_until",sa.DateTime(timezone=True),nullable=True))
    op.create_table("processed_events",sa.Column("id",postgresql.UUID(as_uuid=True),primary_key=True),sa.Column("event_id",postgresql.UUID(as_uuid=True),nullable=False),sa.Column("consumer",sa.String(120),nullable=False),sa.Column("processed_at",sa.DateTime(timezone=True),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.UniqueConstraint("event_id",name="uq_processed_events_event_id")); op.create_index("ix_processed_events_event_id","processed_events",["event_id"],unique=True); op.create_index("ix_processed_events_consumer","processed_events",["consumer"])
def downgrade():
    op.drop_table("processed_events")
    for c in ["retention_until","deleted_at","scan_status"]: op.drop_column("uploaded_files",c)
    op.drop_constraint("fk_refresh_sessions_replaced_by_session_id_refresh_sessions","refresh_sessions",type_="foreignkey")
    for c in ["reuse_detected_at","replaced_by_session_id","family_id"]: op.drop_column("refresh_sessions",c)
    for c in ["last_attempt_at","sending_started_at","delivery_key"]: op.drop_column("campaign_recipients",c)
    for c in ["last_heartbeat_at","active_task_id","execution_token"]: op.drop_column("campaigns",c)
