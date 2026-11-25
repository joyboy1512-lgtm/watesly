from types import SimpleNamespace

from app.services.ai_ops import (
    build_escalation_reply,
    matches_escalation_keywords,
)
from app.services.catalog_intelligence import build_clarifying_catalog_reply


def test_matches_default_escalation_keywords():
    assert matches_escalation_keywords("أبي أرفع شكوى") == "شكوى"
    assert matches_escalation_keywords("I want a refund now") == "refund"
    assert matches_escalation_keywords("بكم الصابون؟") is None


def test_custom_escalation_keywords_override_defaults():
    assert matches_escalation_keywords("شكوى", ["مدير فقط"]) is None
    assert matches_escalation_keywords("كلّم المدير رجاءً", ["مدير"]) == "مدير"


def test_empty_keywords_list_falls_back_to_defaults():
    assert matches_escalation_keywords("أحتاج محامي", []) == "محامي"


def test_build_escalation_reply_marks_dialogue():
    reply = build_escalation_reply(contact_name="سارة", reason="شكوى")
    assert reply["source"] == "escalate"
    assert reply["dialogue"]["escalated"] is True
    assert "موظف" in reply["suggestion"]


def _fake_scored(name: str, score: float = 0.5):
    product = SimpleNamespace(
        id=f"id-{name}",
        name=name,
        price=1.5,
        currency="KWD",
        description="",
        specs_json={},
        product_type=None,
        aliases_json=[],
    )
    return SimpleNamespace(
        product=product,
        score=score,
        reasons=["test"],
        family_tokens=set(),
        type_match=True,
        attribute_match=True,
        alias_hit=False,
        size_match=None,
    )


def test_clarify_escalates_after_max_rounds(monkeypatch):
    # Avoid needing real CatalogProduct helpers beyond attribute access.
    monkeypatch.setattr(
        "app.services.catalog_intelligence._option_label",
        lambda product: product.name,
    )
    monkeypatch.setattr(
        "app.services.catalog_intelligence._match_payload",
        lambda item, index=None: {"id": str(item.product.id), "name": item.product.name, "score": item.score},
    )
    monkeypatch.setattr(
        "app.services.catalog_intelligence.local_intent",
        lambda _query: {"intent": "browse"},
    )
    monkeypatch.setattr(
        "app.services.catalog_intelligence.expand_query_terms",
        lambda _query: set(),
    )
    monkeypatch.setattr(
        "app.services.catalog_intelligence._parsed_debug",
        lambda _query: {},
    )

    scored = [_fake_scored("Rose Soap"), _fake_scored("Coffee Soap", 0.48)]

    first = build_clarifying_catalog_reply(
        scored,
        contact_name="علي",
        query="صابون",
        format_price=lambda _p: "1.5 KWD",
        dialogue_state={"clarify_rounds": 0},
        clarify_max_rounds=2,
    )
    assert first["needs_clarification"] is True
    assert first["dialogue"]["clarify_rounds"] == 1
    assert first.get("dialogue", {}).get("escalated") is not True

    second = build_clarifying_catalog_reply(
        scored,
        contact_name="علي",
        query="مو واضح",
        format_price=lambda _p: "1.5 KWD",
        dialogue_state={"clarify_rounds": 1, "clarify_options": first["clarify_options"]},
        clarify_max_rounds=2,
    )
    assert second["needs_clarification"] is True
    assert second["dialogue"]["clarify_rounds"] == 2

    third = build_clarifying_catalog_reply(
        scored,
        contact_name="علي",
        query="بعد",
        format_price=lambda _p: "1.5 KWD",
        dialogue_state={"clarify_rounds": 2, "clarify_options": second["clarify_options"]},
        clarify_max_rounds=2,
    )
    assert third["source"] == "escalate"
    assert third["dialogue"]["escalated"] is True
