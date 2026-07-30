"""Extended business reports — compliance, team, ops, executive."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.automation import Automation
from app.models.automation_run import AutomationRun, AutomationRunStatus
from app.models.campaign import Campaign
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.organization import Organization
from app.models.user import User
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.services.analytics import agent_performance, analytics_insights, sla_metrics
from app.services.business_reports import reports_overview
from app.services.crm import crm_stats
from app.services.csat import csat_metrics


def _pct_change(current: float | int, previous: float | int) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


async def overview_enhanced(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    current = await reports_overview(db, account_id=account_id, days=days)
    prev_since = datetime.now(UTC) - timedelta(days=days * 2)
    since = datetime.now(UTC) - timedelta(days=days)

    prev_new_contacts = int(
        (await db.scalar(
            select(func.count(Contact.id)).where(
                Contact.account_id == account_id,
                Contact.deleted_at.is_(None),
                Contact.created_at >= prev_since,
                Contact.created_at < since,
            )
        ))
        or 0
    )
    changes = {
        "new_contacts": _pct_change(current["new_contacts"], prev_new_contacts),
        "sla_breaches": None,
        "open_conversations": None,
    }
    return {**current, "changes_pct": changes}


async def compliance_report(db: AsyncSession, *, account_id: UUID, limit: int = 50) -> dict:
    base = Contact.account_id == account_id, Contact.deleted_at.is_(None)
    total = int((await db.scalar(select(func.count(Contact.id)).where(*base))) or 0)
    opt_in = int(
        (await db.scalar(select(func.count(Contact.id)).where(*base, Contact.marketing_opt_in.is_(True))))
        or 0
    )
    opt_out = int(
        (await db.scalar(select(func.count(Contact.id)).where(*base, Contact.marketing_opt_in.is_(False))))
        or 0
    )
    without_email = int(
        (await db.scalar(
            select(func.count(Contact.id)).where(
                *base,
                (Contact.email.is_(None)) | (func.trim(Contact.email) == ""),
            )
        ))
        or 0
    )
    without_name = int(
        (await db.scalar(
            select(func.count(Contact.id)).where(
                *base,
                (Contact.display_name.is_(None)) | (func.trim(Contact.display_name) == ""),
            )
        ))
        or 0
    )
    dup_rows = list(
        (
            await db.execute(
                select(Contact.external_address, func.count(Contact.id).label("cnt"))
                .where(*base)
                .group_by(Contact.external_address)
                .having(func.count(Contact.id) > 1)
                .order_by(func.count(Contact.id).desc())
                .limit(limit)
            )
        ).all()
    )
    opt_out_contacts = list(
        (
            await db.execute(
                select(Contact)
                .where(*base, Contact.marketing_opt_in.is_(False))
                .order_by(Contact.updated_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    org_count = int(
        (await db.scalar(select(func.count(Organization.id)).where(Organization.account_id == account_id)))
        or 0
    )
    return {
        "summary": {
            "total_contacts": total,
            "marketing_opt_in": opt_in,
            "marketing_opt_out": opt_out,
            "without_email": without_email,
            "without_name": without_name,
            "duplicate_phones": len(dup_rows),
            "organizations": org_count,
        },
        "opt_out_contacts": [
            {
                "id": str(c.id),
                "display_name": c.display_name,
                "phone": c.external_address,
                "email": c.email,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in opt_out_contacts
        ],
        "duplicate_phones": [{"phone": row.external_address, "count": int(row.cnt)} for row in dup_rows],
    }


async def team_report(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    agents = await agent_performance(db, account_id=account_id, days=days)
    sla = await sla_metrics(db, account_id=account_id, days=days)
    csat = await csat_metrics(db, account_id=account_id, days=days)
    return {"period_days": days, "summary": {**sla, "csat": csat}, "agents": agents}


async def automations_report(db: AsyncSession, *, account_id: UUID, days: int = 30, limit: int = 50) -> dict:
    since = datetime.now(UTC) - timedelta(days=days)
    automations = list(
        (await db.execute(select(Automation).where(Automation.account_id == account_id))).scalars().all()
    )
    rows = []
    total_runs = succeeded = failed = 0
    for automation in automations:
        runs = list(
            (
                await db.execute(
                    select(AutomationRun).where(
                        AutomationRun.automation_id == automation.id,
                        AutomationRun.created_at >= since,
                    )
                )
            ).scalars().all()
        )
        run_total = len(runs)
        run_ok = sum(1 for r in runs if r.status == AutomationRunStatus.SUCCEEDED)
        run_fail = sum(1 for r in runs if r.status == AutomationRunStatus.FAILED)
        total_runs += run_total
        succeeded += run_ok
        failed += run_fail
        rows.append({
            "id": str(automation.id),
            "name": automation.name,
            "status": automation.status.value if hasattr(automation.status, "value") else str(automation.status),
            "trigger_type": automation.trigger_type.value if hasattr(automation.trigger_type, "value") else str(automation.trigger_type),
            "runs": run_total,
            "succeeded": run_ok,
            "failed": run_fail,
            "success_rate": round(run_ok / run_total * 100, 1) if run_total else None,
        })
    rows.sort(key=lambda item: (-item["runs"], item["name"]))
    return {
        "period_days": days,
        "summary": {
            "automations": len(automations),
            "total_runs": total_runs,
            "succeeded": succeeded,
            "failed": failed,
            "success_rate": round(succeeded / total_runs * 100, 1) if total_runs else None,
        },
        "automations": rows[:limit],
    }


async def whatsapp_ops_report(db: AsyncSession, *, account_id: UUID) -> dict:
    accounts = list(
        (await db.execute(select(WhatsAppAccount).where(WhatsAppAccount.account_id == account_id))).scalars().all()
    )
    pending_templates = int(
        (await db.scalar(
            select(func.count(WhatsAppTemplate.id)).where(
                WhatsAppTemplate.account_id == account_id,
                WhatsAppTemplate.status == TemplateStatus.PENDING,
            )
        ))
        or 0
    )
    rejected_templates = int(
        (await db.scalar(
            select(func.count(WhatsAppTemplate.id)).where(
                WhatsAppTemplate.account_id == account_id,
                WhatsAppTemplate.status == TemplateStatus.REJECTED,
            )
        ))
        or 0
    )
    return {
        "summary": {
            "connected_lines": len(accounts),
            "active_lines": sum(
                1
                for a in accounts
                if (a.status.value if hasattr(a.status, "value") else str(a.status)) == "active"
            ),
            "pending_templates": pending_templates,
            "rejected_templates": rejected_templates,
        },
        "accounts": [
            {
                "id": str(a.id),
                "display_phone_number": a.display_phone_number,
                "verified_name": a.verified_name,
                "status": a.status.value if hasattr(a.status, "value") else str(a.status),
                "quality_rating": a.quality_rating,
                "messaging_limit_tier": a.messaging_limit_tier,
                "health_synced_at": a.health_synced_at.isoformat() if a.health_synced_at else None,
            }
            for a in accounts
        ],
    }


async def campaign_roi_report(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since = datetime.now(UTC) - timedelta(days=days)
    campaigns = list(
        (
            await db.execute(
                select(Campaign).where(Campaign.account_id == account_id, Campaign.created_at >= since)
            )
        ).scalars().all()
    )
    deals_from_inbound = int(
        (await db.scalar(
            select(func.count(Deal.id)).where(
                Deal.account_id == account_id,
                Deal.created_at >= since,
                Deal.source.in_(("inbound", "whatsapp", "campaign")),
            )
        ))
        or 0
    )
    won_deals = list(
        (
            await db.execute(
                select(Deal).where(
                    Deal.account_id == account_id,
                    Deal.stage == "won",
                    Deal.updated_at >= since,
                )
            )
        ).scalars().all()
    )
    won_value = round(sum(float(d.amount or 0) for d in won_deals), 3)
    return {
        "period_days": days,
        "summary": {
            "campaigns": len(campaigns),
            "deals_created": deals_from_inbound,
            "deals_won": len(won_deals),
            "won_value": won_value,
        },
        "campaigns": [{"id": str(c.id), "name": c.name, "status": c.status.value if hasattr(c.status, "value") else str(c.status)} for c in campaigns[:20]],
        "recent_won": [
            {
                "id": str(d.id),
                "title": d.title,
                "amount": str(d.amount or 0),
                "currency": d.currency,
                "source": d.source,
            }
            for d in won_deals[:20]
        ],
    }


async def executive_summary_report(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    overview = await overview_enhanced(db, account_id=account_id, days=days)
    crm = await crm_stats(db, account_id=account_id)
    csat = await csat_metrics(db, account_id=account_id, days=days)
    sla = await sla_metrics(db, account_id=account_id, days=days)
    insights = await analytics_insights(db, account_id=account_id, days=days)
    roi = await campaign_roi_report(db, account_id=account_id, days=days)
    return {
        "period_days": days,
        "generated_at": datetime.now(UTC).isoformat(),
        "overview": overview,
        "crm": crm,
        "csat": csat,
        "sla": sla,
        "roi": roi["summary"],
        "insights": insights["insights"][:5],
    }


async def audit_report(db: AsyncSession, *, account_id: UUID, days: int = 30, limit: int = 100) -> dict:
    since = datetime.now(UTC) - timedelta(days=days)
    logs = list(
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.account_id == account_id, AuditLog.created_at >= since)
                .order_by(AuditLog.created_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    user_ids = {log.actor_user_id for log in logs if log.actor_user_id}
    users: dict[UUID, User] = {}
    if user_ids:
        user_rows = list(
            (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        )
        users = {u.id: u for u in user_rows}
    by_action: dict[str, int] = {}
    for log in logs:
        by_action[log.action] = by_action.get(log.action, 0) + 1
    return {
        "period_days": days,
        "summary": {"total_events": len(logs), "unique_actions": len(by_action)},
        "by_action": [{"action": k, "count": v} for k, v in sorted(by_action.items(), key=lambda x: -x[1])],
        "events": [
            {
                "id": str(log.id),
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "actor_name": users[log.actor_user_id].full_name if log.actor_user_id and log.actor_user_id in users else None,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }
