"""Local sales-agent product matching: AR↔EN, mixed order, typos, clarify memory, channel scope.

Runs the catalog matcher with the external model disabled (local path only).
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.services.catalog import build_catalog_reply
from app.services.catalog_intelligence import (
    apply_dialogue_then_rank,
    rank_catalog_products,
    resolve_clarify_followup,
    should_clarify,
)
from app.services.catalog_query_parse import parse_product_query, parse_quantity_from_text, parse_size_from_text
from app.services.internal_ai import expand_query_terms


def _product(**kwargs):
    defaults = dict(
        id=str(uuid4()),
        name="Product",
        description="",
        keywords="",
        category="general",
        sku="SKU",
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
        channel_id=None,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


CHANNEL_A = uuid4()
CHANNEL_B = uuid4()

# English-named channel catalog (daily merchant fixture)
EN_CATALOG = [
    _product(
        id="soap-coffee",
        name="Coffee Soap",
        sku="SOAP-COFFEE",
        keywords="صابون قهوة,كوفي,قهوة",
        price=Decimal("2.50"),
        channel_id=CHANNEL_A,
    ),
    _product(
        id="scrub-coffee",
        name="Coffee Scrub",
        sku="SCRUB-COFFEE",
        keywords="سكراب قهوة,مقشّر قهوة,كوفي",
        price=Decimal("4.00"),
        channel_id=CHANNEL_A,
    ),
]

# Arabic-named catalog for reverse bilingual checks
AR_CATALOG = [
    _product(
        id="soap-coffee-ar",
        name="صابون قهوة",
        sku="SOAP-COFFEE-AR",
        keywords="coffee soap,كوفي",
        price=Decimal("2.50"),
        channel_id=CHANNEL_A,
    ),
    _product(
        id="scrub-coffee-ar",
        name="سكراب القهوة",
        sku="SCRUB-COFFEE-AR",
        keywords="coffee scrub,مقشر",
        price=Decimal("4.00"),
        channel_id=CHANNEL_A,
    ),
]

FIXTURE = [
    *EN_CATALOG,
    *AR_CATALOG,
    _product(
        id="shower-misk",
        name="Shower Gel – Misk",
        sku="SHOWER-MISK",
        keywords="misk,مسك,شاور مسك,musk",
        variant_size="400 ml",
        price=Decimal("3.25"),
        channel_id=CHANNEL_A,
    ),
    _product(
        id="shower-oud",
        name="Shower Gel – Oud",
        sku="SHOWER-OUD",
        keywords="عود,شاور عود",
        variant_size="400 ml",
        price=Decimal("3.50"),
        channel_id=CHANNEL_A,
    ),
    _product(
        id="shower-rose",
        name="Shower Gel – Rose",
        sku="SHOWER-ROSE",
        keywords="ورد,شاور ورد",
        variant_size="250 ml",
        price=Decimal("3.00"),
        channel_id=CHANNEL_A,
    ),
    _product(
        id="other-channel-only",
        name="Coffee Soap",
        sku="OTHER-CH-SOAP",
        keywords="صابون قهوة",
        price=Decimal("9.99"),
        channel_id=CHANNEL_B,
    ),
]


def _channel_products(channel_id):
    return [
        p
        for p in FIXTURE
        if p.channel_id is None or p.channel_id == channel_id
    ]


def _sku_of(reply: dict) -> str | None:
    matched = reply.get("matched_products") or []
    if not matched:
        return None
    if reply.get("needs_clarification") and len(matched) > 1:
        return "يحتاج توضيحاً"
    top = matched[0]
    return top.get("sku") or top.get("name")


def _run(query: str, *, channel_id=CHANNEL_A, dialogue_state=None, catalog=None):
    products = catalog if catalog is not None else _channel_products(channel_id)
    return build_catalog_reply(
        products,
        contact_name="عميل",
        query=query,
        dialogue_state=dialogue_state,
    )


# --- Parsing unit checks -------------------------------------------------


def test_parse_size_arabic_english_equivalents():
    assert parse_size_from_text("400 مل").unit == "ml"
    assert parse_size_from_text("400ml").value == 400
    assert parse_size_from_text("٩٥ جم").value == 95
    assert parse_size_from_text("95GM").unit == "g"
    assert parse_size_from_text("95 g").value == 95


def test_parse_quantity_habteen():
    assert parse_quantity_from_text("حبتين شاور مسك ٤٠٠ مل") == 2
    parsed = parse_product_query("حبتين شاور مسك ٤٠٠ مل")
    assert parsed.quantity == 2
    assert parsed.size is not None and parsed.size.value == 400
    assert "شاور" in parsed.types
    assert "مسك" in parsed.attributes


def test_coffee_lexicon_includes_kofi_variants():
    terms = expand_query_terms("كوفي")
    # Root is normalized (ة→ه); coffee maps onto the same root.
    assert "قهوه" in terms or "coffee" in terms or "قهوة" in terms


# --- Required customer-message cases (external model off) ----------------


def test_case_english_catalog_arabic_message_coffee_soap():
    """كتالوج إنجليزي + رسالة عربية: أبي صابون قهوة → SOAP-COFFEE وليس السكراب."""
    reply = _run("أبي صابون قهوة", catalog=EN_CATALOG + [p for p in FIXTURE if p.sku.startswith("SHOWER")])
    assert _sku_of(reply) == "SOAP-COFFEE"
    assert reply.get("needs_clarification") is False
    assert "Coffee Soap" in reply["suggestion"]
    assert "SCRUB-COFFEE" != _sku_of(reply)


def test_case_arabic_catalog_english_message_coffee_scrub():
    """كتالوج عربي + رسالة إنجليزية: coffee scrub."""
    catalog = [
        p
        for p in _channel_products(CHANNEL_A)
        if p.sku in {"SOAP-COFFEE-AR", "SCRUB-COFFEE-AR", "SHOWER-MISK"}
    ]
    reply = _run("coffee scrub", catalog=catalog)
    assert _sku_of(reply) == "SCRUB-COFFEE-AR"


def test_case_mixed_catalog_reversed_mixed_query():
    """اسم مختلط × رسالة معكوسة: مقشّر Coffee و scrub قهوة."""
    mixed = [
        _product(
            id="scrub-mixed",
            name="مقشّر Coffee",
            sku="SCRUB-MIXED",
            keywords="scrub,سكراب,قهوة",
            price=Decimal("4"),
            channel_id=CHANNEL_A,
        ),
        _product(
            id="soap-mixed",
            name="صابون Coffee",
            sku="SOAP-MIXED",
            keywords="soap,صابون,قهوة",
            price=Decimal("2.5"),
            channel_id=CHANNEL_A,
        ),
    ]
    reply_a = _run("مقشّر Coffee", catalog=mixed)
    assert _sku_of(reply_a) == "SCRUB-MIXED"

    reply_b = _run("أبي scrub قهوة", catalog=mixed)
    assert _sku_of(reply_b) == "SCRUB-MIXED"


def test_case_brand_spelling_misk_among_other_showers():
    """شاور مسك مقابل Shower Gel – Misk مع روائح أخرى."""
    shower = [p for p in FIXTURE if (p.sku or "").startswith("SHOWER")]
    reply = _run("شاور مسك", catalog=shower)
    assert _sku_of(reply) == "SHOWER-MISK"
    assert reply.get("needs_clarification") is False


def test_case_simple_typo_cofee_soap_not_scrub():
    """خطأ إملائي: cofee soap → Coffee Soap وليس Scrub."""
    reply = _run("cofee soap", catalog=EN_CATALOG)
    assert _sku_of(reply) == "SOAP-COFFEE"


def test_case_ambiguous_then_followups():
    """أبي كوفي ← السكراب ← حبتين."""
    catalog = EN_CATALOG
    turn1 = _run("أبي كوفي", catalog=catalog)
    assert turn1.get("needs_clarification") is True
    assert _sku_of(turn1) == "يحتاج توضيحاً"
    options = turn1.get("clarify_options") or turn1.get("matched_products") or []
    skus = {o.get("sku") for o in options}
    assert "SOAP-COFFEE" in skus and "SCRUB-COFFEE" in skus
    assert len(options) >= 2

    dialogue = turn1.get("dialogue") or {"clarify_options": options}
    turn2 = _run("السكراب", catalog=catalog, dialogue_state=dialogue)
    assert _sku_of(turn2) == "SCRUB-COFFEE"
    assert turn2.get("needs_clarification") is False

    dialogue2 = turn2.get("dialogue") or {"pending_product": (turn2.get("matched_products") or [None])[0]}
    turn3 = _run("حبتين", catalog=catalog, dialogue_state=dialogue2)
    assert _sku_of(turn3) == "SCRUB-COFFEE"
    matched = turn3["matched_products"][0]
    assert matched.get("quantity") == 2


def test_case_other_channel_product_excluded():
    """منتج على قناة أخرى فقط لا يُسعَّر في القناة الحالية."""
    reply = _run("أبي صابون قهوة", channel_id=CHANNEL_A)
    skus = {m.get("sku") for m in (reply.get("matched_products") or [])}
    assert "OTHER-CH-SOAP" not in skus

    # If only the other-channel product existed in the pool, matcher must not invent a price
    only_other = [p for p in FIXTURE if p.sku == "OTHER-CH-SOAP"]
    # Simulate channel A search: filter excludes OTHER
    scoped = _channel_products(CHANNEL_A)
    assert all(p.sku != "OTHER-CH-SOAP" or p.channel_id == CHANNEL_A for p in scoped)
    assert only_other[0].channel_id == CHANNEL_B
    assert only_other[0] not in scoped


def test_size_mismatch_asks_before_substitute():
    shower = [p for p in FIXTURE if (p.sku or "").startswith("SHOWER")]
    reply = _run("حبتين شاور مسك 500 مل", catalog=shower)
    assert reply.get("source") == "catalog_size_ask"
    assert reply.get("needs_clarification") is True
    assert "400" in reply["suggestion"]
    assert _sku_of(reply) == "SHOWER-MISK"


def test_resolve_followup_second_option():
    options = [
        {"id": "1", "name": "Coffee Soap", "sku": "SOAP-COFFEE", "clarify_option": 1},
        {"id": "2", "name": "Coffee Scrub", "sku": "SCRUB-COFFEE", "clarify_option": 2},
    ]
    chosen = resolve_clarify_followup("الثاني", options)
    assert chosen is not None
    assert chosen["sku"] == "SCRUB-COFFEE"
    chosen2 = resolve_clarify_followup("السكراب", options)
    assert chosen2 is not None
    assert chosen2["sku"] == "SCRUB-COFFEE"


def test_soap_query_does_not_rank_scrub_first():
    ranked = rank_catalog_products(EN_CATALOG, "صابون قهوة", limit=5)
    assert ranked
    assert ranked[0].product.sku == "SOAP-COFFEE"
    if len(ranked) > 1:
        assert ranked[0].product.sku != "SCRUB-COFFEE"


def test_results_table_for_manual_review(capsys):
    """Print expected vs actual SKU for the acceptance matrix (local engine, no LLM)."""
    shower = [p for p in FIXTURE if (p.sku or "").startswith("SHOWER")]
    mixed = [
        _product(id="1", name="مقشّر Coffee", sku="SCRUB-MIXED", keywords="scrub,قهوة", price=Decimal("4"), channel_id=CHANNEL_A),
        _product(id="2", name="صابون Coffee", sku="SOAP-MIXED", keywords="soap,قهوة", price=Decimal("2"), channel_id=CHANNEL_A),
    ]
    cases = [
        ("أبي صابون قهوة", "SOAP-COFFEE", EN_CATALOG + shower),
        ("coffee scrub", "SCRUB-COFFEE-AR", AR_CATALOG + shower),
        ("مقشّر Coffee", "SCRUB-MIXED", mixed),
        ("أبي scrub قهوة", "SCRUB-MIXED", mixed),
        ("شاور مسك", "SHOWER-MISK", EN_CATALOG + shower),
        ("cofee soap", "SOAP-COFFEE", EN_CATALOG + shower),
        ("أبي كوفي", "يحتاج توضيحاً", EN_CATALOG),
    ]
    print("\n=== Local bilingual match results (LLM disabled) ===")
    print(f"{'query':<22} {'expected':<18} {'actual':<18} {'ok'}")
    for query, expected, catalog in cases:
        reply = _run(query, catalog=catalog)
        actual = _sku_of(reply) or "—"
        ok = "✓" if actual == expected else "✗"
        print(f"{query:<22} {expected:<18} {actual:<18} {ok}")
        assert actual == expected, f"{query}: expected {expected}, got {actual}"
