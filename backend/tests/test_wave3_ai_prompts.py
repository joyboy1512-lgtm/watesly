from pathlib import Path

import pytest

from app.services.llm_client import LLMError, REWRITE_PROMPTS, rewrite_text


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_rewrite_prompts_cover_inbox_needs() -> None:
    assert set(REWRITE_PROMPTS) >= {
        "tone_professional",
        "tone_friendly",
        "tone_empathetic",
        "tone_straightforward",
        "grammar",
        "simplify",
    }


@pytest.mark.asyncio
async def test_rewrite_rejects_unsupported_prompt() -> None:
    with pytest.raises(LLMError, match="UNSUPPORTED_REWRITE_PROMPT"):
        await rewrite_text(text="مرحبا", prompt_key="unknown")


def test_inbox_tools_exposes_rewrite_route() -> None:
    routes = read("app/api/routes/inbox_tools.py")
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert '@router.post("/rewrite")' in routes
    assert "/inbox-tools/rewrite" in page
    assert "تحسين الصياغة" in page
    assert "مرحلة Lifecycle" in page
