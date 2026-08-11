from uuid import UUID

from app.models.catalog_product import CatalogProduct
from app.services.catalog_commerce import build_meta_catalog_product_payload


def test_build_meta_catalog_product_payload_includes_variants() -> None:
    product = CatalogProduct(
        account_id=UUID("00000000-0000-0000-0000-000000000001"),
        name="Shower Gel 400ml",
        price=2.5,
        currency="KWD",
        meta_item_group_id="shower-gel-dovey",
        variant_size="400ml",
        variant_color="White",
        variant_attributes={"Scent": "Lavender"},
        meta_retailer_id="DOVEY-400-WHT",
    )
    payload = build_meta_catalog_product_payload(product)
    assert payload["item_group_id"] == "shower-gel-dovey"
    assert payload["size"] == "400ml"
    assert payload["color"] == "White"
    assert '"Scent": "Lavender"' in payload["additional_variant_attributes"]
