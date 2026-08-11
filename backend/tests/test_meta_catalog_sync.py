from app.services.meta_catalog_sync import normalize_review_status, parse_meta_review_status


def test_parse_meta_review_status_from_string() -> None:
    status, detail = parse_meta_review_status({"review_status": "PENDING"})
    assert status == "pending"
    assert detail is None


def test_parse_meta_review_status_from_whatsapp_capability_map() -> None:
    status, detail = parse_meta_review_status(
        {
            "capability_to_review_status": {"whatsapp": "REJECTED"},
            "review_rejection_reasons": ["Image quality too low"],
        }
    )
    assert status == "rejected"
    assert detail == "Image quality too low"


def test_normalize_review_status_maps_no_review() -> None:
    assert normalize_review_status("NO_REVIEW") == "no_review"
    assert normalize_review_status("approved") == "approved"
