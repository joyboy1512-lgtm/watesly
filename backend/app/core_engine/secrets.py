from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret, encrypt_secret
from app.models.integration_secret import IntegrationSecret


class SecretsVault(ABC):
    @abstractmethod
    async def put(
        self,
        db: AsyncSession,
        *,
        account_id: UUID,
        name: str,
        value: str,
    ) -> None: ...

    @abstractmethod
    async def get(
        self,
        db: AsyncSession,
        *,
        account_id: UUID,
        name: str,
    ) -> str: ...


class DatabaseSecretsVault(SecretsVault):
    async def put(
        self,
        db: AsyncSession,
        *,
        account_id: UUID,
        name: str,
        value: str,
    ) -> None:
        result = await db.execute(
            select(IntegrationSecret).where(
                IntegrationSecret.account_id == account_id,
                IntegrationSecret.name == name,
            )
        )
        item = result.scalar_one_or_none()
        encrypted = encrypt_secret(value)
        if item is None:
            item = IntegrationSecret(
                account_id=account_id,
                name=name,
                encrypted_value=encrypted,
            )
            db.add(item)
        else:
            item.encrypted_value = encrypted
            item.version += 1
        await db.commit()

    async def get(
        self,
        db: AsyncSession,
        *,
        account_id: UUID,
        name: str,
    ) -> str:
        result = await db.execute(
            select(IntegrationSecret).where(
                IntegrationSecret.account_id == account_id,
                IntegrationSecret.name == name,
            )
        )
        item = result.scalar_one_or_none()
        if item is None:
            raise ValueError("SECRET_NOT_FOUND")
        return decrypt_secret(item.encrypted_value)


secrets_vault: SecretsVault = DatabaseSecretsVault()
