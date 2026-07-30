from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.report import CampaignReportResponse
from app.services.crm import crm_report
from app.services.reports_extended import (
    audit_report,
    automations_report,
    campaign_roi_report,
    compliance_report,
    executive_summary_report,
    overview_enhanced,
    team_report,
    whatsapp_ops_report,
)
from app.services.business_reports import (
    campaigns_report,
    catalog_report,
    knowledge_report,
    quick_replies_report,
    conversations_report,
    customer_report,
    engagement_report,
    export_report_csv,
    export_report_xlsx,
    inactivity_report,
    names_report,
    reports_overview,
)
from app.services.campaigns import (
    export_campaign_recipients_csv,
    export_campaign_recipients_xlsx,
    get_campaign_report,
    list_campaign_recipients,
)

router = APIRouter()

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _export_response(*, content: str | bytes, filename: str, media_type: str) -> Response | PlainTextResponse:
    if isinstance(content, bytes):
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    return PlainTextResponse(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _build_export(
    db: AsyncSession,
    *,
    account_id: UUID,
    report_type: str,
    days: int,
    fmt: str,
) -> Response | PlainTextResponse:
    if fmt == "csv":
        content = await export_report_csv(db, account_id=account_id, report_type=report_type, days=days)
        return _export_response(content=content, filename=f"{report_type}-report.csv", media_type="text/csv")
    if fmt == "xlsx":
        content = await export_report_xlsx(db, account_id=account_id, report_type=report_type, days=days)
        return _export_response(content=content, filename=f"{report_type}-report.xlsx", media_type=XLSX_MEDIA)
    raise HTTPException(status_code=400, detail="Unsupported format. Use xlsx or csv")


@router.get("/overview")
async def get_reports_overview(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await overview_enhanced(db, account_id=context.account_id, days=days)


@router.get("/customers")
async def get_customer_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await customer_report(db, account_id=context.account_id, days=days, limit=limit)


@router.get("/names")
async def get_names_report(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await names_report(db, account_id=context.account_id, limit=limit)


@router.get("/engagement")
async def get_engagement_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await engagement_report(db, account_id=context.account_id, days=days, limit=limit)


@router.get("/campaigns")
async def get_campaigns_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await campaigns_report(db, account_id=context.account_id, days=days, limit=limit)


@router.get("/conversations")
async def get_conversations_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await conversations_report(db, account_id=context.account_id, days=days, limit=limit)


@router.get("/inactivity")
async def get_inactivity_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await inactivity_report(db, account_id=context.account_id, inactive_days=days, limit=limit)


@router.get("/catalog")
async def get_catalog_report(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await catalog_report(db, account_id=context.account_id, limit=limit)


@router.get("/knowledge")
async def get_knowledge_report(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_report(db, account_id=context.account_id, limit=limit)


@router.get("/crm")
async def get_crm_report_route(
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await crm_report(db, account_id=context.account_id)


@router.get("/compliance")
async def get_compliance_report(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await compliance_report(db, account_id=context.account_id, limit=limit)


@router.get("/team")
async def get_team_report(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await team_report(db, account_id=context.account_id, days=days)


@router.get("/automations")
async def get_automations_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await automations_report(db, account_id=context.account_id, days=days, limit=limit)


@router.get("/whatsapp")
async def get_whatsapp_ops_report(
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await whatsapp_ops_report(db, account_id=context.account_id)


@router.get("/roi")
async def get_campaign_roi_report(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await campaign_roi_report(db, account_id=context.account_id, days=days)


@router.get("/executive")
async def get_executive_summary(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await executive_summary_report(db, account_id=context.account_id, days=days)


@router.get("/audit")
async def get_audit_report(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(100, ge=1, le=500),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await audit_report(db, account_id=context.account_id, days=days, limit=limit)


@router.get("/overview/export")
async def export_overview_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="overview", days=days, fmt=format)


@router.get("/customers/export")
async def export_customers_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="customers", days=days, fmt=format)


@router.get("/names/export")
async def export_names_report(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="names", days=30, fmt=format)


@router.get("/engagement/export")
async def export_engagement_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="engagement", days=days, fmt=format)


@router.get("/campaigns/export")
async def export_campaigns_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="campaigns", days=days, fmt=format)


@router.get("/conversations/export")
async def export_conversations_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="conversations", days=days, fmt=format)


@router.get("/inactivity/export")
async def export_inactivity_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="inactivity", days=days, fmt=format)


@router.get("/catalog/export")
async def export_catalog_report(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="catalog", days=30, fmt=format)


@router.get("/knowledge/export")
async def export_knowledge_report(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="knowledge", days=30, fmt=format)


@router.get("/quick-replies")
async def get_quick_replies_report(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await quick_replies_report(db, account_id=context.account_id, limit=limit)


@router.get("/quick-replies/export")
async def export_quick_replies_report(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="quick_replies", days=30, fmt=format)


@router.get("/compliance/export")
async def export_compliance_report(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="compliance", days=30, fmt=format)


@router.get("/team/export")
async def export_team_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="team", days=days, fmt=format)


@router.get("/automations/export")
async def export_automations_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="automations", days=days, fmt=format)


@router.get("/whatsapp/export")
async def export_whatsapp_report(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="whatsapp", days=30, fmt=format)


@router.get("/executive/export")
async def export_executive_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="executive", days=days, fmt=format)


@router.get("/audit/export")
async def export_audit_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="audit", days=days, fmt=format)


@router.get("/roi/export")
async def export_roi_report(
    days: int = Query(30, ge=1, le=365),
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_export(db, account_id=context.account_id, report_type="roi", days=days, fmt=format)


@router.get("/campaigns/{campaign_id}/recipients")
async def campaign_recipients(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_campaign_recipients(
            db, account_id=context.account_id, campaign_id=campaign_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Campaign not found") from exc


@router.get("/campaigns/{campaign_id}/recipients/export")
async def export_campaign_recipients(
    campaign_id: UUID,
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    try:
        if format == "csv":
            content = await export_campaign_recipients_csv(
                db, account_id=context.account_id, campaign_id=campaign_id
            )
            return _export_response(
                content=content,
                filename=f"campaign-{campaign_id}-recipients.csv",
                media_type="text/csv",
            )
        content = await export_campaign_recipients_xlsx(
            db, account_id=context.account_id, campaign_id=campaign_id
        )
        return _export_response(
            content=content,
            filename=f"campaign-{campaign_id}-recipients.xlsx",
            media_type=XLSX_MEDIA,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Campaign not found") from exc


@router.get("/campaigns/{campaign_id}", response_model=CampaignReportResponse)
async def campaign_report(
    campaign_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_campaign_report(
            db,
            account_id=context.account_id,
            campaign_id=campaign_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Campaign not found") from exc
