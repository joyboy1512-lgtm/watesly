from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class MessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID | None
    direction: str
    type: str
    from_address: str
    to_address: str
    text_body: str | None
    status: str
    created_at: datetime
    media_url: str | None = None
    media_filename: str | None = None
    media_caption: str | None = None
