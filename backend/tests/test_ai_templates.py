from app.services.ai_templates import normalize_template_draft


def test_normalize_template_draft_defaults() -> None:
    draft = normalize_template_draft(
        {
            "name": "Ramadan Offer!",
            "language": "ar",
            "category": "marketing",
            "header_type": "TEXT",
            "header_text": "عرض رمضان",
            "body_text": "مرحبا {{1}}، خصم خاص اليوم.",
            "body_samples": ["أحمد"],
            "footer_text": "Watesly",
            "buttons": [{"type": "QUICK_REPLY", "text": "مهتم"}],
            "image_prompt": "",
            "notes": "مسودة",
        }
    )
    assert draft["name"] == "ramadan_offer"
    assert draft["category"] == "marketing"
    assert draft["header_type"] == "TEXT"
    assert draft["body_samples"] == ["أحمد"]
    assert draft["buttons"][0]["text"] == "مهتم"


def test_normalize_rejects_empty_body() -> None:
    try:
        normalize_template_draft({"name": "x", "body_text": "  "})
        assert False, "expected ValueError"
    except ValueError as exc:
        assert str(exc) == "EMPTY_TEMPLATE_BODY"
