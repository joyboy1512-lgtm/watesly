from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.campaign import (
    CampaignCreateRequest,
    CampaignListItemResponse,
    CampaignPreflightRequest,
    CampaignReportSummary,
    CampaignResponse,
)
from app.models.whatsapp_template import WhatsAppTemplate
from app.services.whatsapp_window import campaign_audience_preflight
from app.services.campaigns import (
    approve_campaign,
    archive_campaign,
    cancel_campaign,
    create_campaign,
    delete_draft_campaign,
    export_campaign_recipients_csv,
    export_campaign_recipients_xlsx,
    get_campaign,
    get_campaign_report,
    list_campaign_recipients,
    list_campaigns_with_reports,
    pause_campaign,
    prepare_campaign_start,
    unarchive_campaign,
)
from app.services.contact_management import import_contacts_file
from app.workers.campaign_tasks import run_campaign

router = APIRouter()
class CancelCampaignRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=2000)

def _error(exc: ValueError) -> HTTPException:
    code = str(exc)
    if code == "ACCESS_FORBIDDEN":
        return HTTPException(status_code=403, detail=code)
    if code == "CAMPAIGN_NOT_FOUND":
        status_code = 404
    elif code in {
        "CAMPAIGN_CANNOT_ARCHIVE",
        "CAMPAIGN_NOT_ARCHIVED",
        "CAMPAIGN_CANNOT_DELETE",
        "CAMPAIGN_HAS_FOLLOW_UPS",
        "TIER_LIMIT_EXCEEDED",
        "QUALITY_RED",
        "NO_FAILED_RECIPIENTS",
        "CAMPAIGN_CANNOT_RETRY",
    }:
        status_code = 409
    else:
        status_code = 409
    return HTTPException(status_code=status_code, detail=code)

@router.get("", response_model=list[CampaignListItemResponse])
async def get_campaigns(
    limit: int = Query(100, ge=1, le=200),
    include_archived: bool = Query(False),
    archived_only: bool = Query(False),
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_campaigns_with_reports(
        db,
        context.account_id,
        membership=context.membership,
        limit=limit,
        include_archived=include_archived,
        archived_only=archived_only,
    )

@router.get("/{campaign_id}/report", response_model=CampaignReportSummary)
async def campaign_report(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_campaign_report(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.get("/{campaign_id}/recipients")
async def campaign_recipients(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_campaign_recipients(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.get("/{campaign_id}/recipients/export")
async def export_campaign_recipients(
    campaign_id: UUID,
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        if format == "csv":
            content = await export_campaign_recipients_csv(
                db,
                account_id=context.account_id,
                campaign_id=campaign_id,
                membership=context.membership,
            )
            return Response(
                content=content,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="campaign-{campaign_id}-recipients.csv"'},
            )
        content = await export_campaign_recipients_xlsx(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="campaign-{campaign_id}-recipients.xlsx"'},
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def post_campaign(payload: CampaignCreateRequest, context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)), db: AsyncSession = Depends(get_db)):
    try:
        return await create_campaign(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            payload=payload,
            membership=context.membership,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=code) from exc
        messages = {
            "ALL_RECIPIENTS_OPTED_OUT": "كل العملاء المختارين رفضوا التسويق (opt-out).",
            "ALL_RECIPIENTS_UNREACHABLE": "لا يوجد مستلمون قابلون للوصول — راجع فحص الجمهور قبل الإرسال.",
            "INVALID_RECIPIENT": "بعض العملاء غير صالحين لهذا الفرع — اختر الفرع والقناة ثم حمّل الجمهور من جديد.",
            "RECIPIENT_CHANNEL_MISMATCH": "العملاء المختارون لا ينتمون لقناة WhatsApp المحددة — اضغط «إلغاء التحديد» ثم اختر من جديد.",
            "INVALID_WHATSAPP_ACCOUNT": "حساب WhatsApp غير صالح.",
            "INVALID_TEMPLATE": "القالب غير موجود.",
            "TEMPLATE_ACCOUNT_MISMATCH": "القالب لا ينتمي لحساب WhatsApp المختار.",
            "TEMPLATE_NOT_APPROVED": "القالب غير معتمد بعد — انتظر موافقة Meta.",
            "DUPLICATE_RECIPIENT": "يوجد عميل مكرر في قائمة المستلمين.",
            "ORGANIZATION_MISMATCH": "الفرع المختار لا يطابق حساب WhatsApp.",
        }
        raise HTTPException(status_code=400, detail=messages.get(code, code)) from exc

@router.post("/import-audience")
async def import_campaign_audience(
    organization_id: UUID = Form(...),
    channel_id: UUID = Form(...),
    file: UploadFile = File(...),
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    filename = file.filename or "audience.xlsx"
    from app.services.membership_access import (
        ensure_membership_channel_access,
        ensure_membership_organization_access,
    )

    try:
        await ensure_membership_organization_access(
            db,
            account_id=context.account_id,
            membership=context.membership,
            organization_id=organization_id,
        )
        await ensure_membership_channel_access(
            db,
            account_id=context.account_id,
            membership=context.membership,
            channel_id=channel_id,
        )
        return await import_contacts_file(
            db,
            account_id=context.account_id,
            organization_id=organization_id,
            channel_id=channel_id,
            content=content,
            filename=filename,
        )
    except ValueError as exc:
        code = str(exc)
        if code in {"ACCESS_FORBIDDEN", "CONVERSATION_FORBIDDEN"}:
            raise HTTPException(status_code=403, detail=code) from exc
        messages = {
            "UNSUPPORTED_FILE_FORMAT": "صيغة الملف غير مدعومة. استخدم .xlsx أو .csv",
            "FILE_TOO_LARGE": "حجم الملف كبير جداً (الحد الأقصى 10 MB)",
            "INVALID_CHANNEL": "القناة غير صالحة.",
            "CHANNEL_ORGANIZATION_MISMATCH": "القناة لا تتبع الفرع المختار.",
        }
        raise HTTPException(status_code=400, detail=messages.get(code, code)) from exc


@router.post("/preflight")
async def post_campaign_preflight(
    payload: CampaignPreflightRequest,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.membership_access import ensure_whatsapp_account_access

    template = await db.get(WhatsAppTemplate, payload.template_id)
    if template is None or template.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Template not found")
    try:
        await ensure_whatsapp_account_access(
            db,
            account_id=context.account_id,
            membership=context.membership,
            whatsapp_account_id=payload.whatsapp_account_id,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=code) from exc
        raise HTTPException(status_code=400, detail="Invalid WhatsApp account") from exc
    category = template.category.value if hasattr(template.category, "value") else str(template.category)
    return await campaign_audience_preflight(
        db,
        account_id=context.account_id,
        contact_ids=payload.contact_ids,
        template_category=category,
        whatsapp_account_id=payload.whatsapp_account_id,
        template_components=template.components,
        include_opt_out_option=payload.include_opt_out_option,
        exclude_unreachable=payload.exclude_unreachable,
        exclude_risky=payload.exclude_risky,
    )


@router.post("/{campaign_id}/approve", response_model=CampaignResponse)
async def approve(campaign_id: UUID, context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_APPROVE, write=True)), db: AsyncSession = Depends(get_db)):
    try:
        return await approve_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            user_id=context.user.id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.post("/{campaign_id}/start", response_model=CampaignResponse)
async def start(campaign_id: UUID, context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)), db: AsyncSession = Depends(get_db)):
    try:
        campaign = await prepare_campaign_start(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc: raise _error(exc) from exc
    from datetime import UTC, datetime
    from app.services.scheduler import schedule_job

    if campaign.scheduled_at and campaign.scheduled_at > datetime.now(UTC):
        await schedule_job(
            db,
            account_id=context.account_id,
            job_type="campaign.start",
            payload={"campaign_id": str(campaign.id), "execution_token": str(campaign.execution_token)},
            run_at=campaign.scheduled_at,
        )
        await db.refresh(campaign)
        return campaign
    task = run_campaign.apply_async(
        args=[str(campaign.id), str(campaign.execution_token)],
        queue="campaigns",
    )
    campaign.active_task_id = task.id
    await db.commit(); await db.refresh(campaign)
    return campaign

@router.post("/{campaign_id}/pause", response_model=CampaignResponse)
async def pause(campaign_id: UUID, context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)), db: AsyncSession = Depends(get_db)):
    try:
        return await pause_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.post("/{campaign_id}/cancel", response_model=CampaignResponse)
async def cancel(campaign_id: UUID, payload: CancelCampaignRequest, context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_APPROVE, write=True)), db: AsyncSession = Depends(get_db)):
    try:
        return await cancel_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            reason=payload.reason,
            membership=context.membership,
        )
    except ValueError as exc: raise _error(exc) from exc


@router.post("/{campaign_id}/retry-failed", response_model=CampaignResponse)
async def retry_failed(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.campaign_recovery import retry_failed_campaign_recipients

    try:
        await retry_failed_campaign_recipients(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
        return await get_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc


@router.post("/{campaign_id}/archive", response_model=CampaignResponse)
async def archive(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await archive_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.post("/{campaign_id}/unarchive", response_model=CampaignResponse)
async def unarchive(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await unarchive_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc

@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_draft_campaign(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class FollowUpCampaignRequest(BaseModel):
    follow_up_type: str = Field(pattern=r"^(not_delivered|not_read|failed)$")


@router.post("/{campaign_id}/follow-up", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_follow_up(
    campaign_id: UUID,
    payload: FollowUpCampaignRequest,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.campaign_follow_up import create_follow_up_campaign

    try:
        return await create_follow_up_campaign(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            campaign_id=campaign_id,
            follow_up_type=payload.follow_up_type,
            membership=context.membership,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=code) from exc
        status_code = 404 if code == "CAMPAIGN_NOT_FOUND" else 400
        raise HTTPException(status_code=status_code, detail=code) from exc
