from decimal import Decimal
from types import SimpleNamespace

from app.services.catalog_commerce import (
    format_meta_sync_error,
    validate_product_for_meta_sync,
)


def _product(**kwargs):
    defaults = {
        "name": "Test Product",
        "price": Decimal("10.00"),
        "image_url": "https://cdn.example.com/product.jpg",
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
    assert validate_product_for_meta_sync(_product()) is None


def test_format_meta_sync_error_catalog_permission() -> None:
    message = format_meta_sync_error("(#200) Requires catalog_management permission")
    assert "catalog_management" in message


def test_format_meta_sync_error_invalid_token() -> None:
    message = format_meta_sync_error("Invalid OAuth access token")
    assert "توكن" in message
