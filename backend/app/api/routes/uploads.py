from tempfile import SpooledTemporaryFile
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.db.session import get_db
from app.models.uploaded_file import UploadedFile
from app.schemas.upload import UploadResponse
from app.services.storage import storage
from app.core.file_security import sanitize_filename, validate_file_content
from app.core.config import settings
from app.core.permissions import Permission

router = APIRouter()

MAX_UPLOAD_SIZE = settings.max_upload_bytes
ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "audio/mpeg",
    "audio/ogg",
    "application/pdf",
}


@router.post("", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    context: AuthContext = Depends(require_permissions(Permission.FILES_UPLOAD, write=True)),
    db: AsyncSession = Depends(get_db),
) -> UploadResponse:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported file type")

    safe_name = sanitize_filename(file.filename or "unnamed")
    total=0; header=b""
    spool=SpooledTemporaryFile(max_size=min(MAX_UPLOAD_SIZE,5*1024*1024),mode="w+b")
    while chunk:=await file.read(1024*1024):
        total+=len(chunk)
        if total>MAX_UPLOAD_SIZE: spool.close(); raise HTTPException(status_code=413,detail="File exceeds the configured upload limit")
        if len(header)<8192: header=(header+chunk)[:8192]
        spool.write(chunk)
    try: validate_file_content(safe_name,file.content_type,header)
    except ValueError as exc: spool.close(); raise HTTPException(status_code=415,detail=str(exc)) from exc
    spool.seek(0)
    key, public_url = storage.upload_fileobj(
        account_id=context.account_id,
        filename=safe_name,
        content_type=file.content_type,
        fileobj=spool,
    )
    spool.close()
    item = UploadedFile(
        account_id=context.account_id,
        uploaded_by_user_id=context.user.id,
        filename=safe_name,
        content_type=file.content_type,
        size_bytes=total,
        object_key=key,
        public_url=public_url,
        scan_status="available",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    return UploadResponse(
        id=item.id,
        filename=item.filename,
        content_type=item.content_type,
        size_bytes=item.size_bytes,
        object_key=item.object_key,
        public_url=item.public_url,
    )


@router.get("", response_model=list[UploadResponse])
async def list_files(
    context: AuthContext = Depends(require_permissions(Permission.FILES_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[UploadResponse]:
    result = await db.execute(
        select(UploadedFile)
        .where(UploadedFile.account_id == context.account_id, UploadedFile.deleted_at.is_(None), UploadedFile.scan_status == "available")
        .order_by(UploadedFile.created_at.desc())
    )
    return [
        UploadResponse(
            id=item.id,
            filename=item.filename,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            object_key=item.object_key,
            public_url=item.public_url,
        )
        for item in result.scalars().all()
    ]


@router.get("/{file_id}/download")
async def get_download_url(
    file_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.FILES_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = await db.get(UploadedFile, file_id)
    if item is None or item.account_id != context.account_id or item.deleted_at is not None or item.scan_status != "available":
        raise HTTPException(status_code=404, detail="File not found")
    return {
        "url": storage.create_presigned_download_url(item.object_key),
    }
