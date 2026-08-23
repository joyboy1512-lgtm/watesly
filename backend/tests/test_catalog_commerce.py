from app.services.catalog_commerce import parse_meta_catalog_visible


def test_parse_meta_catalog_visible_accepts_bool_and_string() -> None:
    assert parse_meta_catalog_visible({"is_catalog_visible": True}) is True
    assert parse_meta_catalog_visible({"is_catalog_visible": "true"}) is True
    assert parse_meta_catalog_visible({"is_catalog_visible": "false"}) is False
    assert parse_meta_catalog_visible({}) is None
    assert parse_meta_catalog_visible(None) is None
