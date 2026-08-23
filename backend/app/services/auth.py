from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token_value, hash_opaque_token, hash_password, verify_password
from app.models.account import Account
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.refresh_session import RefreshSession
from app.models.user import User, UserStatus
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services.billing import create_trial_subscription

async def get_user_by_email(db: AsyncSession,email:str)->User|None:
    return (await db.execute(select(User).where(User.email==email))).scalar_one_or_none()

async def issue_token_pair(db:AsyncSession,*,user:User,account_id:UUID,family_id:UUID|None=None)->tuple[str,str]:
    refresh=create_refresh_token_value(); session=RefreshSession(user_id=user.id,account_id=account_id,token_hash=hash_opaque_token(refresh),expires_at=datetime.now(UTC)+timedelta(days=settings.refresh_token_expire_days),family_id=family_id or uuid4())
    db.add(session); await db.flush()
    access=create_access_token(user_id=user.id,account_id=account_id,session_id=session.id,password_changed_at=user.password_changed_at)
    await db.commit(); return access,refresh

async def register_owner(db:AsyncSession,payload:RegisterRequest):
    if await get_user_by_email(db,payload.email): raise ValueError("EMAIL_ALREADY_REGISTERED")
    async with db.begin():
        account=Account(name=payload.account_name); db.add(account); await db.flush()
        org=Organization(account_id=account.id,name=payload.organization_name,slug=payload.organization_slug,country_code=payload.country_code,currency_code=payload.currency_code,timezone=payload.timezone,default_language=payload.preferred_language)
        user=User(email=payload.email,full_name=payload.full_name,password_hash=hash_password(payload.password),preferred_language=payload.preferred_language,status=UserStatus.ACTIVE,password_changed_at=datetime.now(UTC))
        db.add_all([org,user]); await db.flush(); membership=Membership(account_id=account.id,user_id=user.id,role=MembershipRole.OWNER,status=MembershipStatus.ACTIVE); db.add(membership); await db.flush(); db.add(OrganizationMembership(organization_id=org.id,membership_id=membership.id)); await create_trial_subscription(db,account_id=account.id)
    access,refresh=await issue_token_pair(db,user=user,account_id=account.id); return user,account,org,access,refresh

async def list_active_memberships(db:AsyncSession,user_id:UUID)->list[Membership]:
    return list((await db.execute(select(Membership).where(Membership.user_id==user_id,Membership.status==MembershipStatus.ACTIVE).order_by(Membership.created_at.asc()))).scalars().all())

async def authenticate_user(db:AsyncSession,payload:LoginRequest):
    from app.models.account import Account, AccountStatus

    blocked_account_statuses = {
        AccountStatus.SUSPENDED,
        AccountStatus.CANCELLED,
        AccountStatus.SCHEDULED_FOR_DELETION,
        AccountStatus.CLOSED,
    }
    user=await get_user_by_email(db,payload.email); now=datetime.now(UTC)
    if user is None or (user.locked_until and user.locked_until>now): return None
    if not verify_password(payload.password,user.password_hash):
        user.failed_login_attempts+=1
        if user.failed_login_attempts>=settings.login_max_attempts: user.locked_until=now+timedelta(minutes=settings.login_lock_minutes); user.failed_login_attempts=0
        await db.commit(); return None
    if user.status!=UserStatus.ACTIVE: return None
    user.failed_login_attempts=0; user.locked_until=None; await db.commit()
    memberships=await list_active_memberships(db,user.id)
    if not memberships: return None
    membership=next((m for m in memberships if payload.account_id and m.account_id==payload.account_id),None)
    if payload.account_id and membership is None: raise ValueError("ACCOUNT_NOT_AVAILABLE")
    membership=membership or (memberships[0] if len(memberships)==1 else None)
    if membership is None: return (user,memberships,None,None)
    account = await db.get(Account, membership.account_id)
    if account is None or account.status in blocked_account_statuses:
        raise ValueError("ACCOUNT_NOT_ACTIVE")
    access,refresh=await issue_token_pair(db,user=user,account_id=membership.account_id); return user,membership,access,refresh

async def rotate_refresh_token(db:AsyncSession,refresh_token:str)->tuple[str,str]|None:
    h=hash_opaque_token(refresh_token); now=datetime.now(UTC)
    async with db.begin():
        session=(await db.execute(select(RefreshSession).where(RefreshSession.token_hash==h).with_for_update())).scalar_one_or_none()
        if session is None or session.expires_at<=now: return None
        if session.revoked_at is not None:
            session.reuse_detected_at=now
            await db.execute(update(RefreshSession).where(RefreshSession.family_id==session.family_id,RefreshSession.revoked_at.is_(None)).values(revoked_at=now))
            return None
        user=await db.get(User,session.user_id)
        if user is None or user.status!=UserStatus.ACTIVE: return None
        new_refresh=create_refresh_token_value(); replacement=RefreshSession(user_id=session.user_id,account_id=session.account_id,token_hash=hash_opaque_token(new_refresh),expires_at=now+timedelta(days=settings.refresh_token_expire_days),family_id=session.family_id)
        db.add(replacement); await db.flush(); session.revoked_at=now; session.replaced_by_session_id=replacement.id
        access=create_access_token(user_id=user.id,account_id=session.account_id,session_id=replacement.id,password_changed_at=user.password_changed_at)
    return access,new_refresh

async def revoke_refresh_token(db:AsyncSession,refresh_token:str)->bool:
    session=(await db.execute(select(RefreshSession).where(RefreshSession.token_hash==hash_opaque_token(refresh_token)))).scalar_one_or_none()
    if not session:return False
    if session.revoked_at is None: session.revoked_at=datetime.now(UTC); await db.commit()
    return True
async def revoke_all_user_sessions(db:AsyncSession,user_id)->int:
    items=list((await db.execute(select(RefreshSession).where(RefreshSession.user_id==user_id,RefreshSession.revoked_at.is_(None)))).scalars().all()); now=datetime.now(UTC)
    for x in items:x.revoked_at=now
    await db.commit(); return len(items)
