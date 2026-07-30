from uuid import UUID

from pydantic import BaseModel


class UploadResponse(BaseModel):
    id: UUID
    filename: str
    content_type: str | None
    size_bytes: int
    object_key: str
    public_url: str
