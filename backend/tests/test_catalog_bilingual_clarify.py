from decimal import Decimal
from types import SimpleNamespace

from app.services.catalog_intelligence import (
    build_precise_catalog_reply,
    rank_catalog_products,
    should_clarify,
)
from app.services.internal_ai import expand_query_terms


def _product(**kwargs):
    defaults = dict(
        id="x",
        name="Product",
        description="",
        keywords="",
        category="general",
        sku="",
        variant_size=None,
        variant_color=None,
        variant_attributes={},
        meta_item_group_id=None,
        price=Decimal("1.00"),
        currency="KWD",
        price_type="fixed",
        image_url=None,
        product_type="product",
        meta_retailer_id=None,
        specs_json={},
        usage_count=0,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_arabic_query_matches_english_product_name():
    terms = expand_query_terms("صابون سائل عود")
    assert "soap" in terms or "صابون" in terms
    assert "liquid" in terms or "سائل" in terms or "سايل" in terms
    assert "oud" in terms or "عود" in terms

    english = _product(id="1", name="liquid soap oud", keywords="soap,liquid,oud", price=Decimal("2.5"))
    other = _product(id="2", name="rose cream", keywords="cream,rose", price=Decimal("3"))
    ranked = rank_catalog_products([english, other], "صابون سائل عود", limit=3)
    assert ranked
    assert ranked[0].product.id == "1"


def test_broad_soap_query_asks_clarification_not_random_price():
    products = [
        _product(id="1", name="Liquid Soap Oud", keywords="soap,liquid,oud", price=Decimal("2.5")),
        _product(id="2", name="Shower Gel Musk", keywords="shower,gel,soap", price=Decimal("3.0")),
        _product(id="3", name="Bar Soap Rose", keywords="soap,bar", price=Decimal("1.5")),
        _product(id="4", name="Body Scrub Coffee", keywords="scrub,soap", price=Decimal("4.0")),
    ]
    ranked = rank_catalog_products(products, "كم سعر الصابون", limit=8, min_score=0.15)
    assert len(ranked) >= 2
    assert should_clarify(ranked, query="كم سعر الصابون")

    def format_price(p):
        return f"{p.price} {p.currency}"

    def format_specs(_):
        return ""

    reply = build_precise_catalog_reply(
        ranked,
        contact_name="أحمد",
        query="كم سعر الصابون",
        format_price=format_price,
        format_specs=format_specs,
    )
    assert reply["needs_clarification"] is True
    assert reply["source"] == "catalog_clarify"
    assert "أي واحد تقصد" in reply["suggestion"]
    assert "بدون تخمين" in reply["suggestion"]
    assert len(reply["matched_products"]) >= 2


def test_exact_product_skips_clarification():
    products = [
        _product(id="1", name="Liquid Soap Oud", keywords="soap,liquid,oud", price=Decimal("2.5")),
        _product(id="2", name="Shower Gel Musk", keywords="shower,gel", price=Decimal("3.0")),
    ]
    ranked = rank_catalog_products(products, "liquid soap oud", limit=5)
    assert ranked[0].product.id == "1"
    assert should_clarify(ranked, query="liquid soap oud") is False
