from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScheduleJobRequest(BaseModel):
    job_type: str = Field(min_length=2, max_length=100)
    payload: dict = Field(default_factory=dict)
    run_at: datetime
    max_attempts: int = Field(default=5, ge=1, le=20)


class ScheduledJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_type: str
    payload: dict
    run_at: datetime
    status: str
    attempts: int
    max_attempts: int


class ModuleHealthResponse(BaseModel):
    module_name: str
    instance_id: str
    status: str
    heartbeat_at: datetime
    details: dict
