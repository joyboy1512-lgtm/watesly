"""Unit tests for AI agent skills normalization and HTTP safety."""

from __future__ import annotations

import pytest

from app.services.ai_agent_skills import (
    default_skills,
    normalize_skills_json,
    substitute_template,
)


def test_normalize_defaults_when_empty():
    assert normalize_skills_json(None) == default_skills()
    assert normalize_skills_json({}) == default_skills()
    assert normalize_skills_json("bad") == default_skills()


def test_normalize_bools_and_actions():
    raw = {
        "assign_to_human": True,
        "update_lifecycle": "yes",
        "close_conversation": 0,
        "http_request": True,
        "actions": [
            {
                "name": "create_lead",
                "when": "after collect",
                "method": "post",
                "url": "https://example.com/hooks/lead",
                "headers": {"X-Token": "abc"},
                "body_template": '{"phone":"{{phone}}"}',
                "required_fields": "name, phone",
            },
            {
                "name": "too_many",
                "url": "https://example.com/2",
            },
            {
                "name": "third",
                "url": "https://example.com/3",
            },
            {
                "name": "fourth_dropped",
                "url": "https://example.com/4",
            },
        ],
    }
    result = normalize_skills_json(raw)
    assert result["assign_to_human"] is True
    assert result["update_lifecycle"] is True
    assert result["close_conversation"] is False
    assert result["http_request"] is True
    assert len(result["actions"]) == 3
    first = result["actions"][0]
    assert first["name"] == "create_lead"
    assert first["method"] == "POST"
    assert first["url"] == "https://example.com/hooks/lead"
    assert first["required_fields"] == ["name", "phone"]
    assert first["headers"]["X-Token"] == "abc"


def test_normalize_rejects_empty_url():
    raw = {
        "http_request": True,
        "actions": [
            {"name": "missing", "url": ""},
            {"name": "blank", "url": "   "},
            {"name": "ok", "url": "https://example.com/ok"},
        ],
    }
    result = normalize_skills_json(raw)
    assert len(result["actions"]) == 1
    assert result["actions"][0]["name"] == "ok"
    assert result["actions"][0]["url"] == "https://example.com/ok"


def test_substitute_template_fields():
    text = substitute_template("hi {{name}} / {{phone}}", {"name": "Sara", "phone": "965500"})
    assert text == "hi Sara / 965500"
    assert "{{missing}}" not in substitute_template("x={{missing}}", {})


@pytest.mark.asyncio
async def test_execute_rejects_empty_url_without_request(monkeypatch):
    from uuid import uuid4

    from app.services import ai_agent_skills as skills

    async def _flags(*_args, **_kwargs):
        return {"ai_agent_skills": True}

    monkeypatch.setattr(skills, "get_feature_flags", _flags)

    with pytest.raises(ValueError, match="non-empty url"):
        await skills.execute_http_skill_action(
            db=None,  # type: ignore[arg-type]
            account_id=uuid4(),
            action={"method": "POST", "url": ""},
            collected={},
        )
