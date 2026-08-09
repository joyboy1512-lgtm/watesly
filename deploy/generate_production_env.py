"""Generate backend/.env for watesly.com production from template + random secrets."""
from __future__ import annotations

import base64
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "deploy" / ".env.watesly.com.example"
OUTPUT = ROOT / "backend" / ".env.production.generated"


def main() -> None:
    text = TEMPLATE.read_text(encoding="utf-8")
    db_pass = secrets.token_urlsafe(24)
    minio_pass = secrets.token_urlsafe(24)
    replacements = {
        "CHANGE_ME_min_32_chars": secrets.token_urlsafe(48),
        "CHANGE_ME_fernet_key": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        "CHANGE_ME_DB_PASSWORD": db_pass,
        "CHANGE_ME_MINIO_SECRET": minio_pass,
        "CHANGE_ME_random_string_you_choose": secrets.token_urlsafe(24),
        "CHANGE_ME_from_meta_developer": "REPLACE_AFTER_META_SETUP",
        "CHANGE_ME": secrets.token_urlsafe(16),
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print("Set META_APP_SECRET in this file after Meta Developer setup.")


if __name__ == "__main__":
    main()
