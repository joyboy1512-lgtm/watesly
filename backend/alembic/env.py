from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.base import Base
from app.models import (  # noqa: F401
    account,
    account_data_key,
    audit_log,
    assignment_rule,
    automation,
    automation_run,
    automation_run_step,
    channel,
    campaign,
    campaign_recipient,
    contact,
    conversation,
    conversation_event,
    conversation_note,
    conversation_tag,
    invitation,
    integration_secret,
    idempotency_record,
    invitation_organization,
    membership,
    message,
    module_health,
    notification,
    organization,
    outbox_event,
    organization_membership,
    plan,
    quick_reply,
    refresh_session,
    resource_record,
    subscription,
    scheduled_job,
    support_access_grant,
    team,
    team_member,
    tag,
    uploaded_file,
    user,
    webhook_event,
    whatsapp_account,
    whatsapp_template,
    contact_tag,
    contact_interest,
    interest_category,
    custom_field,
    segment,
    department,
    agent_presence,
    conversation_read_state,
    api_key,
    deal,
    webhook_subscription,
    webhook_delivery,
    marketplace_integration,
    catalog_product,
    knowledge_article,
    ai_agent_settings,
    tracked_link,
    conversation_rating,
    platform_site_config,
    processed_event,
)

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    connectable = async_engine_from_config(
        configuration, prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
