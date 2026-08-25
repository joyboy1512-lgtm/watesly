from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.email_settings import EmailSettingsResponse, EmailSettingsUpdate, EmailTestRequest
from app.services.ai_assistant import (
    agent_capabilities,
    categorize_conversation,
    detect_emotion,
    detect_intent,
    extract_data,
    suggest_reply,
    summarize_conversation,
)
from app.services.analytics import (
    activity_heatmap,
    agent_performance,
    analytics_insights,
    analytics_overview,
    dashboard_analytics,
    campaign_analytics,
    customer_funnel,
    live_dashboard,
    message_time_series,
    revenue_analytics,
    sla_metrics,
)
from app.services.contact_management import (
    add_contact_tag,
    create_custom_field,
    create_segment,
    delete_contact,
    export_contacts_csv,
    get_custom_field_values,
    import_contacts_csv,
    list_contact_tags,
    list_custom_fields,
    list_segments,
    remove_contact_tag,
    resolve_audience_contacts,
    resolve_segment_contacts,
    set_custom_field_value,
    update_contact,
)
from app.services.interests import (
    create_interest,
    list_contact_interests,
    list_interests,
)
from app.services.crm import (
    add_deal_activity,
    bulk_update_stage,
    create_deal,
    create_deal_from_conversation,
    crm_report,
    crm_stats,
    delete_deal,
    export_deals_csv,
    export_deals_xlsx,
    get_deal,
    list_deal_activities,
    list_deals,
    update_deal,
    update_deal_stage,
)
from app.services.developer import (
    create_api_key,
    create_webhook_subscription,
    delete_webhook_subscription,
    developer_docs,
    developer_overview,
    list_api_keys,
    list_marketplace,
    list_webhook_deliveries,
    list_webhook_subscriptions,
    revoke_api_key,
    run_webhook_test,
    serialize_api_key,
    serialize_webhook,
    toggle_webhook_subscription,
)
from app.services.feature_flags import get_feature_flags, feature_flags_metadata, update_feature_flags
from app.services.inbox_extended import mark_conversation_read, mark_conversation_unread
from app.services.search import global_search
from app.services.team_extended import create_department, list_departments, list_presence, set_presence, workload_summary

router = APIRouter()


class SegmentCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    filter_json: dict = Field(default_factory=dict)


class InterestCreateRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=160)
    exclude_genders: list[str] = Field(default_factory=list)
    include_genders: list[str] | None = None


class InterestResponse(BaseModel):
    id: UUID
    slug: str
    label: str
    exclude_genders: list[str]
    include_genders: list[str] | None
    sort_order: int


class AudienceResolveRequest(BaseModel):
    organization_id: UUID | None = None
    channel_id: UUID | None = None
    gender: str | None = Field(default=None, pattern=r"^(male|female|unknown)$")
    exclude_genders: list[str] = Field(default_factory=list)
    interest_ids: list[UUID] = Field(default_factory=list)
    lifecycle_stage: str | None = None
    marketing_opt_in_only: bool = True
    limit: int = Field(default=5000, ge=1, le=5000)


class CustomFieldCreateRequest(BaseModel):
    entity_type: str = "contact"
    field_key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=160)
    field_type: str = "text"


class CustomFieldValueRequest(BaseModel):
    definition_id: UUID
    entity_id: UUID
    value_text: str


class ContactUpdateRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    language: str | None = None
    country_code: str | None = None


class DepartmentCreateRequest(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=160)


class PresenceUpdateRequest(BaseModel):
    status: str = Field(pattern=r"^(online|away|busy|offline)$")


class DealCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    contact_id: UUID | None = None
    stage: str = "lead"
    amount: Decimal = Decimal("0")
    pipeline: str = "default"
    currency: str = "KWD"
    description: str | None = None
    organization_id: UUID | None = None
    assigned_membership_id: UUID | None = None
    probability: int = 0
    source: str | None = "manual"
    expected_close_date: datetime | None = None


class DealUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    contact_id: UUID | None = None
    stage: str | None = None
    amount: Decimal | None = None
    pipeline: str | None = None
    currency: str | None = None
    description: str | None = None
    organization_id: UUID | None = None
    assigned_membership_id: UUID | None = None
    probability: int | None = None
    expected_close_date: datetime | None = None


class DealStageRequest(BaseModel):
    stage: str


class DealActivityRequest(BaseModel):
    activity_type: str = "note"
    body: str = Field(min_length=1)


class DealBulkStageRequest(BaseModel):
    deal_ids: list[UUID] = Field(min_length=1)
    stage: str


class DealFromConversationRequest(BaseModel):
    conversation_id: UUID
    title: str | None = None


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    scopes: list[str] = Field(default_factory=lambda: ["read"])


class WebhookCreateRequest(BaseModel):
    url: str = Field(min_length=8, max_length=500)
    events: list[str] = Field(default_factory=list)


class AiSuggestRequest(BaseModel):
    messages: list[str] = Field(default_factory=list)
    contact_name: str = ""


class AiTextRequest(BaseModel):
    text: str


class AiMessagesRequest(BaseModel):
    messages: list[str] = Field(default_factory=list)


@router.get("/search")
async def search(
    q: str = Query(min_length=1),
    limit: int = Query(20, ge=1, le=50),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await global_search(db, account_id=context.account_id, query=q, limit=limit)


@router.get("/segments")
async def get_segments(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_segments(db, context.account_id)


@router.post("/segments", status_code=201)
async def post_segment(
    payload: SegmentCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await create_segment(db, account_id=context.account_id, name=payload.name, filter_json=payload.filter_json)


@router.get("/segments/{segment_id}/contacts")
async def get_segment_contacts(
    segment_id: UUID,
    channel_id: UUID | None = None,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.segment import Segment

    segment = await db.get(Segment, segment_id)
    if segment is None or segment.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Segment not found")
    contacts = await resolve_segment_contacts(
        db,
        account_id=context.account_id,
        segment=segment,
        channel_id=channel_id,
    )
    return [{"id": str(c.id), "name": c.display_name, "phone": c.external_address} for c in contacts]


@router.get("/segments/{segment_id}/count")
async def get_segment_count(
    segment_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.segment import Segment
    from app.services.contact_management import count_segment_contacts

    segment = await db.get(Segment, segment_id)
    if segment is None or segment.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Segment not found")
    count = await count_segment_contacts(db, account_id=context.account_id, segment=segment)
    return {"segment_id": str(segment_id), "count": count}


@router.get("/interests", response_model=list[InterestResponse])
async def get_interests(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    items = await list_interests(db, context.account_id)
    return [
        InterestResponse(
            id=item.id,
            slug=item.slug,
            label=item.label,
            exclude_genders=list(item.exclude_genders or []),
            include_genders=list(item.include_genders) if item.include_genders else None,
            sort_order=item.sort_order,
        )
        for item in items
    ]


@router.post("/interests", response_model=InterestResponse, status_code=201)
async def post_interest(
    payload: InterestCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await create_interest(
        db,
        account_id=context.account_id,
        slug=payload.slug,
        label=payload.label,
        exclude_genders=payload.exclude_genders,
        include_genders=payload.include_genders,
    )
    return InterestResponse(
        id=item.id,
        slug=item.slug,
        label=item.label,
        exclude_genders=list(item.exclude_genders or []),
        include_genders=list(item.include_genders) if item.include_genders else None,
        sort_order=item.sort_order,
    )


@router.post("/audience/resolve")
async def post_resolve_audience(
    payload: AudienceResolveRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    filters: dict = {}
    if payload.organization_id:
        filters["organization_id"] = str(payload.organization_id)
    if payload.channel_id:
        filters["channel_id"] = str(payload.channel_id)
    if payload.lifecycle_stage:
        filters["lifecycle_stage"] = payload.lifecycle_stage
    if payload.marketing_opt_in_only:
        filters["marketing_opt_in"] = True
    if payload.interest_ids:
        filters["interest_ids"] = [str(item) for item in payload.interest_ids]
    if payload.gender:
        filters["gender"] = payload.gender
    elif payload.exclude_genders:
        filters["exclude_genders"] = payload.exclude_genders

    contacts = await resolve_audience_contacts(
        db,
        account_id=context.account_id,
        filters=filters,
        limit=payload.limit,
    )

    return {
        "count": len(contacts),
        "contact_ids": [str(item.id) for item in contacts],
        "contacts": [
            {
                "id": str(item.id),
                "name": item.display_name,
                "phone": item.external_address,
                "gender": item.gender,
            }
            for item in contacts
        ],
        "warnings": [],
        "filters_applied": filters,
    }


@router.get("/custom-fields")
async def get_custom_fields(
    entity_type: str = "contact",
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_custom_fields(db, context.account_id, entity_type)


@router.post("/custom-fields", status_code=201)
async def post_custom_field(
    payload: CustomFieldCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await create_custom_field(
        db,
        account_id=context.account_id,
        entity_type=payload.entity_type,
        field_key=payload.field_key,
        label=payload.label,
        field_type=payload.field_type,
    )


@router.post("/custom-fields/values", status_code=201)
async def post_custom_field_value(
    payload: CustomFieldValueRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await set_custom_field_value(
        db, definition_id=payload.definition_id, entity_id=payload.entity_id, value_text=payload.value_text
    )


@router.get("/departments")
async def get_departments(
    context: AuthContext = Depends(require_permissions(Permission.ORGANIZATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_departments(db, context.account_id)


@router.post("/departments", status_code=201)
async def post_department(
    payload: DepartmentCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.ORGANIZATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_department(
            db, account_id=context.account_id, organization_id=payload.organization_id, name=payload.name
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/team/presence")
async def get_presence(
    context: AuthContext = Depends(require_permissions(Permission.USERS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_presence(db, context.account_id)


@router.put("/team/presence")
async def put_presence(
    payload: PresenceUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await set_presence(db, membership_id=context.membership.id, status=payload.status)


@router.get("/team/workload")
async def get_workload(
    context: AuthContext = Depends(require_permissions(Permission.USERS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await workload_summary(db, context.account_id)


@router.get("/crm/deals")
async def get_deals(
    q: str | None = None,
    stage: str | None = None,
    pipeline: str | None = None,
    contact_id: UUID | None = None,
    organization_id: UUID | None = None,
    assigned_membership_id: UUID | None = None,
    limit: int = Query(500, ge=1, le=5000),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_deals(
        db,
        context.account_id,
        membership=context.membership,
        q=q,
        stage=stage,
        pipeline=pipeline,
        contact_id=contact_id,
        organization_id=organization_id,
        assigned_membership_id=assigned_membership_id,
        limit=limit,
    )


@router.get("/crm/stats")
async def get_crm_stats(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await crm_stats(db, account_id=context.account_id, membership=context.membership)


@router.get("/crm/report")
async def get_crm_report(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await crm_report(db, account_id=context.account_id, membership=context.membership)


@router.get("/crm/deals/export")
async def export_deals(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    ids: str | None = Query(None, description="Comma-separated deal UUIDs"),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    deal_ids = None
    if ids:
        deal_ids = [UUID(part.strip()) for part in ids.split(",") if part.strip()]
    try:
        if format == "csv":
            content = await export_deals_csv(db, context.account_id, deal_ids=deal_ids)
            filename = "crm-deals-selected.csv" if deal_ids else "crm-deals.csv"
            return PlainTextResponse(
                content,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )
        data = await export_deals_xlsx(db, context.account_id, deal_ids=deal_ids)
        filename = "crm-deals-selected.xlsx" if deal_ids else "crm-deals.xlsx"
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except ModuleNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Excel export unavailable (openpyxl missing)") from exc


@router.post("/crm/deals/bulk-stage")
async def post_bulk_deal_stage(
    payload: DealBulkStageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    updated = await bulk_update_stage(
        db,
        account_id=context.account_id,
        deal_ids=payload.deal_ids,
        stage=payload.stage,
    )
    return {"updated": updated}


@router.post("/crm/deals/from-conversation", status_code=201)
async def post_deal_from_conversation(
    payload: DealFromConversationRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        deal = await create_deal_from_conversation(
            db,
            account_id=context.account_id,
            conversation_id=payload.conversation_id,
            title=payload.title,
        )
        return await get_deal(db, account_id=context.account_id, deal_id=deal.id)
    except ValueError as exc:
        code = 404 if "NOT_FOUND" in str(exc) else 400
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.get("/crm/deals/{deal_id}")
async def get_deal_by_id(
    deal_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_deal(db, account_id=context.account_id, deal_id=deal_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/crm/deals", status_code=201)
async def post_deal(
    payload: DealCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    deal = await create_deal(
        db,
        account_id=context.account_id,
        title=payload.title,
        contact_id=payload.contact_id,
        stage=payload.stage,
        amount=payload.amount,
        pipeline=payload.pipeline,
        currency=payload.currency,
        description=payload.description,
        organization_id=payload.organization_id,
        assigned_membership_id=payload.assigned_membership_id,
        probability=payload.probability,
        source=payload.source,
        expected_close_date=payload.expected_close_date,
    )
    return await get_deal(db, account_id=context.account_id, deal_id=deal.id)


@router.patch("/crm/deals/{deal_id}")
async def patch_deal(
    deal_id: UUID,
    payload: DealUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await update_deal(
            db,
            account_id=context.account_id,
            deal_id=deal_id,
            **payload.model_dump(exclude_unset=True),
        )
        return await get_deal(db, account_id=context.account_id, deal_id=deal_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/crm/deals/{deal_id}", status_code=204)
async def remove_deal(
    deal_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_deal(db, account_id=context.account_id, deal_id=deal_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/crm/deals/{deal_id}/stage")
async def patch_deal_stage(
    deal_id: UUID,
    payload: DealStageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await update_deal_stage(db, account_id=context.account_id, deal_id=deal_id, stage=payload.stage)
        return await get_deal(db, account_id=context.account_id, deal_id=deal_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/crm/deals/{deal_id}/activities")
async def get_deal_activities(
    deal_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_deal_activities(db, deal_id)


@router.post("/crm/deals/{deal_id}/activities", status_code=201)
async def post_deal_activity(
    deal_id: UUID,
    payload: DealActivityRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await add_deal_activity(
        db, deal_id=deal_id, activity_type=payload.activity_type, body=payload.body, user_id=context.user.id
    )


@router.get("/analytics/agents")
async def analytics_agents(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await agent_performance(db, account_id=context.account_id, days=days)


@router.get("/analytics/sla")
async def analytics_sla(
    days: int = Query(7, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await sla_metrics(db, account_id=context.account_id, days=days)


@router.get("/analytics/csat")
async def analytics_csat(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.csat import csat_metrics

    return await csat_metrics(db, account_id=context.account_id, days=days)


@router.get("/analytics/live")
async def analytics_live(
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await live_dashboard(db, account_id=context.account_id)


@router.get("/analytics/overview")
async def analytics_overview_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_overview(db, account_id=context.account_id, days=days)


@router.get("/analytics/dashboard")
async def analytics_dashboard_route(
    days: int = Query(30, ge=1, le=90),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await dashboard_analytics(db, account_id=context.account_id, days=days)


@router.get("/analytics/time-series")
async def analytics_time_series_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await message_time_series(db, account_id=context.account_id, days=days)


@router.get("/analytics/heatmap")
async def analytics_heatmap_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await activity_heatmap(db, account_id=context.account_id, days=days)


@router.get("/analytics/customer-funnel")
async def analytics_customer_funnel_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await customer_funnel(db, account_id=context.account_id, days=days)


@router.get("/analytics/campaigns")
async def analytics_campaigns_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await campaign_analytics(db, account_id=context.account_id, days=days)


@router.get("/analytics/revenue")
async def analytics_revenue_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await revenue_analytics(db, account_id=context.account_id, days=days)


@router.get("/analytics/insights")
async def analytics_insights_route(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_insights(db, account_id=context.account_id, days=days)


@router.get("/ai/capabilities")
async def ai_capabilities(
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    return agent_capabilities()


@router.post("/ai/suggest-reply")
async def ai_suggest_reply(
    payload: AiSuggestRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND)),
    db: AsyncSession = Depends(get_db),
):
    query = payload.messages[-1] if payload.messages else ""
    if query.strip():
        from app.services.knowledge_base import suggest_smart_reply

        return await suggest_smart_reply(
            db,
            account_id=context.account_id,
            query=query,
            contact_name=payload.contact_name,
            mode="kb_first",
        )
    return suggest_reply(last_messages=payload.messages, contact_name=payload.contact_name)


@router.post("/ai/summarize")
async def ai_summarize(
    payload: AiMessagesRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    return summarize_conversation(payload.messages)


@router.post("/ai/intent")
async def ai_intent(
    payload: AiTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    return detect_intent(payload.text)


@router.post("/ai/emotion")
async def ai_emotion(
    payload: AiTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    return detect_emotion(payload.text)


@router.post("/ai/extract")
async def ai_extract(
    payload: AiTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    return extract_data(payload.text)


@router.post("/ai/categorize")
async def ai_categorize(
    payload: AiMessagesRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    return categorize_conversation(payload.messages)


@router.get("/developer/overview")
async def get_developer_overview(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await developer_overview(db, account_id=context.account_id)


@router.get("/developer/docs")
async def get_developer_docs(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
):
    return developer_docs()


@router.get("/developer/webhook-events")
async def get_webhook_events(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
):
    from app.services.webhook_dispatch import WEBHOOK_EVENTS

    return {"events": WEBHOOK_EVENTS}


@router.get("/developer/deliveries")
async def get_webhook_deliveries(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_webhook_deliveries(db, account_id=context.account_id, limit=limit)


@router.get("/developer/api-keys")
async def get_api_keys(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_api_keys(db, context.account_id)


@router.post("/developer/api-keys", status_code=201)
async def post_api_key(
    payload: ApiKeyCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item, raw = await create_api_key(db, account_id=context.account_id, name=payload.name, scopes=payload.scopes)
    data = serialize_api_key(item)
    data["key"] = raw
    return data


@router.delete("/developer/api-keys/{key_id}", status_code=204)
async def delete_api_key(
    key_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await revoke_api_key(db, account_id=context.account_id, key_id=key_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/developer/webhooks")
async def get_webhooks(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_webhook_subscriptions(db, context.account_id)


@router.post("/developer/webhooks", status_code=201)
async def post_webhook(
    payload: WebhookCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item, secret = await create_webhook_subscription(
        db, account_id=context.account_id, url=payload.url, events=payload.events
    )
    data = serialize_webhook(item)
    data["secret"] = secret
    return data


@router.delete("/developer/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_webhook_subscription(db, account_id=context.account_id, webhook_id=webhook_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/developer/webhooks/{webhook_id}/test")
async def test_webhook(
    webhook_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await run_webhook_test(db, account_id=context.account_id, webhook_id=webhook_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/developer/webhooks/{webhook_id}")
async def patch_webhook(
    webhook_id: UUID,
    is_active: bool = Query(...),
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await toggle_webhook_subscription(
            db, account_id=context.account_id, webhook_id=webhook_id, is_active=is_active
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class FeatureFlagsUpdate(BaseModel):
    flags: dict = Field(default_factory=dict)


@router.get("/email-settings", response_model=EmailSettingsResponse)
async def get_email_settings_route(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.account_email_settings import get_email_settings

    try:
        data = await get_email_settings(db, account_id=context.account_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Account not found") from exc
    return EmailSettingsResponse(**data)


@router.patch("/email-settings", response_model=EmailSettingsResponse)
async def patch_email_settings_route(
    payload: EmailSettingsUpdate,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.account_email_settings import update_email_settings

    try:
        data = await update_email_settings(
            db,
            account_id=context.account_id,
            email_notifications_enabled=payload.email_notifications_enabled,
            notification_emails=payload.notification_emails,
            catalog_order_emails=payload.catalog_order_emails,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Account not found") from exc
    return EmailSettingsResponse(**data)


@router.post("/email-settings/test")
async def post_email_settings_test(
    payload: EmailTestRequest,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.account_email_settings import (
        resolve_catalog_order_recipients,
        resolve_notification_recipients,
    )
    from app.services.email import is_email_configured, send_email

    if not is_email_configured():
        raise HTTPException(status_code=409, detail="EMAIL_NOT_CONFIGURED")

    if payload.target == "catalog_order":
        recipients = await resolve_catalog_order_recipients(db, account_id=context.account_id)
    else:
        recipients = await resolve_notification_recipients(db, account_id=context.account_id)

    if not recipients:
        raise HTTPException(status_code=400, detail="NO_EMAIL_RECIPIENTS")

    subject = "اختبار بريد Watesly"
    text_body = "تم إرسال رسالة اختبار من Watesly بنجاح."
    html_body = (
        "<html lang='ar' dir='rtl'><body style='font-family:Arial,sans-serif;'>"
        "<p>تم إرسال رسالة اختبار من <strong>Watesly</strong> بنجاح.</p>"
        "</body></html>"
    )
    sent = 0
    for recipient in recipients:
        await send_email(to=recipient, subject=subject, text_body=text_body, html_body=html_body)
        sent += 1
    return {"sent": sent, "recipients": recipients}


@router.get("/feature-flags")
async def get_account_feature_flags(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_feature_flags(db, account_id=context.account_id)


@router.patch("/feature-flags")
async def patch_account_feature_flags(
    payload: FeatureFlagsUpdate,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_feature_flags(
            db,
            account_id=context.account_id,
            updates=payload.flags,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/marketplace")
async def get_marketplace(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    flags = await get_feature_flags(db, account_id=context.account_id)
    if not flags.get("marketplace_installs", True):
        return []
    items = await list_marketplace(db)
    templates = [
        {
            "slug": "woocommerce-order-updates",
            "name": "WooCommerce — تحديثات الطلب",
            "category": "ecommerce",
            "description": "Webhook → إرسال قالب WhatsApp عند تغيير حالة الطلب",
            "setup": ["POST /developer/webhooks", "Automation: webhook → send_template"],
        },
        {
            "slug": "lead-capture-ctwa",
            "name": "CTWA — التقاط العملاء",
            "category": "growth",
            "description": "رسالة إعلان → lifecycle lead → إنشاء صفقة CRM",
            "setup": ["Trigger: conversation_created", "Action: set_lifecycle + create_deal"],
        },
    ]
    return {"integrations": items, "templates": templates}


@router.get("/integrations/channels")
async def channel_integrations(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    flags = await get_feature_flags(db, account_id=context.account_id)
    from app.services.channel_adapters import ADAPTERS

    instagram_status = "beta" if flags.get("instagram_channel") else "planned"
    messenger_status = "beta" if flags.get("messenger_channel") else "planned"
    return {
        "adapters": sorted(ADAPTERS.keys()),
        "whatsapp": {"status": "active", "note": "WhatsApp Business API — مدمج بالكامل"},
        "instagram": {
            "status": instagram_status,
            "note": "Meta Instagram Messaging — جاهز عبر Channel Adapters",
            "enabled": flags.get("instagram_channel", False),
        },
        "messenger": {
            "status": messenger_status,
            "note": "Meta Messenger — جاهز عبر Channel Adapters",
            "enabled": flags.get("messenger_channel", False),
        },
        "telegram": {"status": "planned", "note": "Bot token — قريباً"},
        "email": {"status": "planned", "note": "SMTP/IMAP — قريباً"},
        "web_chat": {"status": "planned", "note": "Widget embed — قريباً"},
        "sms": {"status": "planned", "note": "Twilio/other — قريباً"},
        "voice": {"status": "planned", "note": "Twilio Voice — قريباً"},
    }


@router.get("/feature-flags/metadata")
async def get_feature_flags_metadata(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
):
    return feature_flags_metadata()


@router.get("/growth/ctwa-dashboard")
async def growth_ctwa_dashboard(
    days: int = Query(30, ge=1, le=365),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    flags = await get_feature_flags(db, account_id=context.account_id)
    if not flags.get("ctwa_dashboard", True):
        raise HTTPException(status_code=403, detail="CTWA_DASHBOARD_DISABLED")
    from app.services.ctwa_dashboard import get_ctwa_dashboard

    return await get_ctwa_dashboard(db, account_id=context.account_id, days=days)


class EcommerceConnectionCreate(BaseModel):
    provider: str = Field(pattern=r"^(shopify|woocommerce)$")
    shop_label: str = Field(min_length=2, max_length=120)
    shop_url: str = Field(min_length=4, max_length=500)
    access_token: str | None = None
    settings: dict = Field(default_factory=dict)


@router.get("/growth/ecommerce-connections")
async def list_ecommerce_connections_route(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ecommerce_integrations import list_ecommerce_connections

    return await list_ecommerce_connections(db, account_id=context.account_id)


@router.post("/growth/ecommerce-connections", status_code=status.HTTP_201_CREATED)
async def create_ecommerce_connection_route(
    payload: EcommerceConnectionCreate,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ecommerce_integrations import create_ecommerce_connection

    try:
        row = await create_ecommerce_connection(
            db,
            account_id=context.account_id,
            provider=payload.provider,
            shop_label=payload.shop_label,
            shop_url=payload.shop_url,
            access_token=payload.access_token,
            settings=payload.settings,
        )
        return {"id": str(row.id), "provider": row.provider, "shop_label": row.shop_label}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class OrderTemplateUpsert(BaseModel):
    event_type: str = Field(min_length=3, max_length=40)
    template_id: UUID
    whatsapp_account_id: UUID
    ecommerce_connection_id: UUID | None = None
    variable_mapping: dict = Field(default_factory=dict)
    is_active: bool = True


@router.get("/growth/order-templates")
async def list_order_templates_route(
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ecommerce_integrations import list_order_templates

    return await list_order_templates(db, account_id=context.account_id)


@router.post("/growth/order-templates")
async def upsert_order_template_route(
    payload: OrderTemplateUpsert,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ecommerce_integrations import upsert_order_template

    try:
        row = await upsert_order_template(
            db,
            account_id=context.account_id,
            event_type=payload.event_type,
            template_id=payload.template_id,
            whatsapp_account_id=payload.whatsapp_account_id,
            ecommerce_connection_id=payload.ecommerce_connection_id,
            variable_mapping=payload.variable_mapping,
            is_active=payload.is_active,
        )
        return {"id": str(row.id), "event_type": row.event_type}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class GrowthAiTextRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    contact_name: str = ""


@router.post("/growth/ai/lead-agent")
async def growth_ai_lead_agent(
    payload: GrowthAiTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.growth_ai import run_lead_agent

    return await run_lead_agent(
        db,
        account_id=context.account_id,
        message=payload.message,
        contact_name=payload.contact_name,
    )


@router.post("/growth/ai/support-agent")
async def growth_ai_support_agent(
    payload: GrowthAiTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.growth_ai import run_support_agent

    return await run_support_agent(
        db,
        account_id=context.account_id,
        message=payload.message,
        contact_name=payload.contact_name,
    )
