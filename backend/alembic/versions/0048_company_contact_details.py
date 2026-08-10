"""Refresh company contact details on public site."""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels = None
depends_on = None


def _deep_merge(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def upgrade() -> None:
    from app.services.site_content_defaults import default_site_config

    defaults = default_site_config()
    conn = op.get_bind()
    row = conn.execute(sa.text("SELECT id, content_json FROM platform_site_config LIMIT 1")).fetchone()
    if row is None:
        return

    content = dict(row.content_json or {})
    for locale in ("ar", "en"):
        stored = content.get(locale, {})
        if not isinstance(stored, dict):
            stored = {}
        content[locale] = _deep_merge(stored, defaults["locales"][locale])

    conn.execute(
        sa.text(
            "UPDATE platform_site_config "
            "SET content_json = CAST(:content AS jsonb), updated_at = now() "
            "WHERE id = :id"
        ),
        {"content": json.dumps(content), "id": str(row.id)},
    )


def downgrade() -> None:
    pass
