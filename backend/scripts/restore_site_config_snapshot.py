#!/usr/bin/env python3
"""Restore platform_site_config from a JSON snapshot (production backup)."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import AsyncSessionFactory
from app.models.platform_site_config import PlatformSiteConfig


async def restore(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    async with AsyncSessionFactory() as db:
        result = await db.execute(select(PlatformSiteConfig).limit(1))
        item = result.scalar_one_or_none()
        if item is None:
            item = PlatformSiteConfig(id=UUID(str(data["id"])))
            db.add(item)

        item.branding_json = data.get("branding_json") or {}
        item.display_json = data.get("display_json") or {}
        item.content_json = data.get("content_json") or {}
        item.is_published = bool(data.get("is_published", True))
        if data.get("published_at"):
            item.published_at = datetime.fromisoformat(str(data["published_at"]))
        else:
            item.published_at = datetime.now(UTC)
        item.updated_at = datetime.now(UTC)
        await db.commit()
        print(f"Restored platform_site_config from {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="Path to platform_site_config JSON")
    args = parser.parse_args()
    asyncio.run(restore(args.snapshot))


if __name__ == "__main__":
    main()
