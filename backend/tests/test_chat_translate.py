import pytest

from app.services.llm_client import LLMError, TRANSLATE_LANG_NAMES, translate_text


def test_translate_langs_cover_arab_world_needs():
    assert set(TRANSLATE_LANG_NAMES) >= {"ar", "en", "fr", "ur", "hi"}


@pytest.mark.asyncio
async def test_translate_rejects_unsupported_target():
    with pytest.raises(LLMError, match="UNSUPPORTED_TARGET_LANG"):
        await translate_text(text="مرحبا", target_lang="xx")


@pytest.mark.asyncio
async def test_translate_returns_none_for_empty_text():
    assert await translate_text(text="   ", target_lang="en") is None
