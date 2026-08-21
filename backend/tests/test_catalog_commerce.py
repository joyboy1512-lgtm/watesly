from decimal import Decimal
from types import SimpleNamespace

from app.services.catalog_commerce import (
    catalog_id_linked_to_waba,
    format_meta_sync_error,
    is_catalog_link_skip_error,
    is_invalid_partner_catalog_error,
    meta_sync_error_for_code,
    validate_product_for_meta_sync,
)


def _product(**kwargs):
    defaults = {
        "name": "Test Product",
        "price": Decimal("10.00"),
        "image_url": "https://cdn.example.com/product.jpg",
        "organization_id": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_validate_product_requires_image() -> None:
    assert validate_product_for_meta_sync(_product(image_url=None)) is not None
    assert validate_product_for_meta_sync(_product(image_url="")) is not None


def test_validate_product_requires_https_image() -> None:
    assert validate_product_for_meta_sync(_product(image_url="ftp://bad")) is not None


def test_validate_product_requires_positive_price() -> None:
    assert validate_product_for_meta_sync(_product(price=None)) is not None
    assert validate_product_for_meta_sync(_product(price=Decimal("0"))) is not None


def test_validate_product_ok() -> None:
    from uuid import uuid4

    assert validate_product_for_meta_sync(_product(organization_id=uuid4())) is None


def test_format_meta_sync_error_invalid_token() -> None:
    message = format_meta_sync_error("Invalid OAuth access token")
    assert "توكن" in message


def test_format_meta_sync_error_catalog_permission() -> None:
    message = format_meta_sync_error("(#200) Requires catalog_management permission")
    assert "catalog_management" in message


def test_format_meta_sync_error_catalog_not_found() -> None:
    message = format_meta_sync_error(
        "Unsupported post request. Object with ID '1677372356655691' does not exist"
    )
    assert "catalog_management" in message


def test_format_meta_sync_error_invalid_partner() -> None:
    message = format_meta_sync_error("Invalid partner")
    assert "Invalid partner" in message
    assert "Commerce Manager" in message


def test_format_meta_sync_error_nonexisting_metadata_field() -> None:
    message = format_meta_sync_error("Tried accessing nonexisting field (#100) (metadata)")
    assert "Product Set" in message or "metadata" in message


def test_catalog_id_linked_to_waba() -> None:
    linked = [{"id": "123"}, {"id": "456", "name": "Shop"}]
    assert catalog_id_linked_to_waba(linked, "456") is True
    assert catalog_id_linked_to_waba(linked, "999") is False
    assert catalog_id_linked_to_waba(linked, "") is False


def test_is_catalog_link_skip_error() -> None:
    assert is_catalog_link_skip_error("Catalog already linked") is True
    assert is_catalog_link_skip_error("Invalid partner") is False


def test_is_invalid_partner_catalog_error() -> None:
    assert is_invalid_partner_catalog_error("Invalid partner") is True
    assert is_invalid_partner_catalog_error("Permission denied") is False


def test_validate_product_requires_organization() -> None:
    assert validate_product_for_meta_sync(_product(organization_id=None)) is not None


def test_meta_sync_error_for_organization_catalog() -> None:
    message = meta_sync_error_for_code("META_CATALOG_NOT_CONFIGURED_FOR_ORGANIZATION")
    assert "Commerce" in message


def test_product_matches_commerce_organization() -> None:
    from uuid import uuid4

    from app.services.catalog_commerce import product_matches_commerce_organization

    org_id = uuid4()
    product = _product(organization_id=org_id)
    account = SimpleNamespace(organization_id=org_id)
    mismatch = SimpleNamespace(organization_id=uuid4())
    assert product_matches_commerce_organization(product, account) is True
    assert product_matches_commerce_organization(product, mismatch) is False
