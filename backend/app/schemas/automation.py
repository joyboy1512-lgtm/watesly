from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.automation import (
    AutomationStatus,
    AutomationTriggerType,
)
from app.models.automation_run import AutomationRunStatus


class AutomationNode(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    type: str = Field(min_length=1, max_length=80)
    position: dict[str, float]
    data: dict


class AutomationEdge(BaseModel):
    id: str = Field(min_length=1, max_length=160)
    source: str
    target: str
    source_handle: str | None = None
    target_handle: str | None = None
    label: str | None = None


class AutomationGraph(BaseModel):
    nodes: list[AutomationNode] = Field(default_factory=list, max_length=200)
    edges: list[AutomationEdge] = Field(default_factory=list, max_length=400)

    @model_validator(mode="after")
    def validate_graph(self):
        node_ids = {node.id for node in self.nodes}
        if len(node_ids) != len(self.nodes):
            raise ValueError("Node IDs must be unique")
        for edge in self.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                raise ValueError("Every edge must reference existing nodes")
        return self


class AutomationCreateRequest(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    trigger_type: AutomationTriggerType
    trigger_config: dict = Field(default_factory=dict)
    graph: AutomationGraph = Field(default_factory=AutomationGraph)


class AutomationUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    trigger_type: AutomationTriggerType | None = None
    trigger_config: dict | None = None
    graph: AutomationGraph | None = None
    status: AutomationStatus | None = None


class AutomationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str
    description: str | None
    status: AutomationStatus
    trigger_type: AutomationTriggerType
    trigger_config: dict
    graph: dict
    version: int
    created_at: datetime
    updated_at: datetime


class AutomationPublishResponse(BaseModel):
    id: UUID
    status: AutomationStatus
    version: int


class AutomationRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    automation_id: UUID
    status: AutomationRunStatus
    current_node_id: str | None
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


class AutomationTestRequest(BaseModel):
    trigger_payload: dict = Field(default_factory=dict)
