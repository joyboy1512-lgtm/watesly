"""Each WhatsApp channel keeps its own local AI catalog + knowledge scope."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.services.catalog import build_catalog_reply
from app.services.knowledge_base import _apply_knowledge_channel_filter
from app.models.knowledge_article import KnowledgeArticle
from sqlalchemy import select


TRAVEL = uuid4()
SOAP_BRAND = uuid4()


def _product(*, sku: str, name: str, channel_id, keywords: str = ""):
    return SimpleNamespace(
        id=str(uuid4()),
        name=name,
        sku=sku,
        keywords=keywords,
        description="",
        category="general",
        variant_size=None,
        variant_color=None,
        variant_attributes={},
        meta_item_group_id=None,
        price=Decimal("2.50"),
        currency="KWD",
        price_type="fixed",
        image_url=None,
        product_type="product",
        meta_retailer_id=None,
        specs_json={},
        usage_count=0,
        channel_id=channel_id,
    )


def test_travel_zone_catalog_does_not_price_soap_channel_product():
    soap = _product(
        sku="SOAP-COFFEE",
        name="Coffee Soap",
        channel_id=SOAP_BRAND,
        keywords="صابون قهوة,coffee",
    )
    travel_bag = _product(
        sku="TRAVEL-BAG",
        name="Travel Neck Pillow",
        channel_id=TRAVEL,
        keywords="سفر,travel,وسادة",
    )
    # Simulate inbound AI pool for Travel Zone (strict channel, no unassigned bleed)
    travel_pool = [p for p in (soap, travel_bag) if p.channel_id == TRAVEL]
    reply = build_catalog_reply(travel_pool, query="أبي صابون قهوة", contact_name="عميل")
    skus = {m.get("sku") for m in (reply.get("matched_products") or [])}
    assert "SOAP-COFFEE" not in skus
    # Weak / empty match — no soap pricing leaked
    assert reply.get("source") in {"catalog", "catalog_weak", "catalog_clarify"}


def test_soap_channel_still_matches_its_own_catalog():
    soap = _product(
        sku="SOAP-COFFEE",
        name="Coffee Soap",
        channel_id=SOAP_BRAND,
        keywords="صابون قهوة,coffee",
    )
    travel_bag = _product(
        sku="TRAVEL-BAG",
        name="Travel Neck Pillow",
        channel_id=TRAVEL,
        keywords="سفر,travel",
    )
    soap_pool = [p for p in (soap, travel_bag) if p.channel_id == SOAP_BRAND]
    reply = build_catalog_reply(soap_pool, query="أبي صابون قهوة")
    assert (reply.get("matched_products") or [])[0]["sku"] == "SOAP-COFFEE"


def test_knowledge_strict_filter_excludes_other_channel():
    query = select(KnowledgeArticle)
    filtered = _apply_knowledge_channel_filter(query, channel_id=TRAVEL, strict=True)
    sql = str(filtered.compile(compile_kwargs={"literal_binds": False}))
    assert "channel_id" in sql.lower()


def test_knowledge_non_strict_allows_unassigned_or_channel():
    query = select(KnowledgeArticle)
    filtered = _apply_knowledge_channel_filter(query, channel_id=TRAVEL, strict=False)
    sql = str(filtered)
    assert "channel_id" in sql.lower()
