from types import SimpleNamespace

from app.services.internal_ai import (
    evaluate_cases,
    expand_query_terms,
    local_intent,
    normalize_text,
    rank_articles,
)


def test_normalize_arabic_variants():
    assert normalize_text("إرجاع") == normalize_text("ارجاع")
    assert "ا" in normalize_text("أحمد")
    assert "ه" in normalize_text("مدة")


def test_synonym_expansion_shipping_and_price():
    shipping = expand_query_terms("كم مدة الديليفري؟")
    assert "توصيل" in shipping or "شحن" in shipping
    pricing = expand_query_terms("ابي اعرف السعر")
    assert "سعر" in pricing


def test_rank_prefers_keyword_and_usage():
    weak = SimpleNamespace(
        id="1",
        title="معلومات عامة",
        body="نص طويل غير مرتبط",
        keywords="",
        category="general",
        usage_count=0,
        helpful_count=0,
        dismiss_count=0,
        sort_order=0,
    )
    strong = SimpleNamespace(
        id="2",
        title="مدة التوصيل",
        body="التوصيل خلال 2-3 أيام عمل داخل الكويت.",
        keywords="شحن, توصيل, مدة",
        category="shipping",
        usage_count=8,
        helpful_count=4,
        dismiss_count=0,
        sort_order=1,
    )
    ranked = rank_articles([weak, strong], "متى يوصل الطلب؟", limit=2)
    assert ranked
    assert ranked[0].article.id == "2"
    assert ranked[0].score > 0.3


def test_dismiss_penalty_lowers_rank():
    good = SimpleNamespace(
        id="a",
        title="الأسعار",
        body="الأسعار تبدأ من 10 د.ك",
        keywords="سعر",
        category="pricing",
        usage_count=2,
        helpful_count=1,
        dismiss_count=0,
        sort_order=0,
    )
    noisy = SimpleNamespace(
        id="b",
        title="أسعار قديمة",
        body="الأسعار تبدأ من 10 د.ك",
        keywords="سعر",
        category="pricing",
        usage_count=20,
        helpful_count=0,
        dismiss_count=12,
        sort_order=0,
    )
    ranked = rank_articles([noisy, good], "كم السعر؟", limit=2)
    assert ranked[0].article.id == "a"


def test_evaluate_cases_hit_rate():
    articles = [
        SimpleNamespace(
            id="ship-1",
            title="التوصيل",
            body="خلال يومين",
            keywords="توصيل,شحن",
            category="shipping",
            usage_count=1,
            helpful_count=1,
            dismiss_count=0,
            sort_order=0,
        )
    ]
    report = evaluate_cases(
        articles,
        [{"query": "متى الشحن؟", "expected_title": "التوصيل"}, {"query": "xyzunknown", "expected_title": "التوصيل"}],
    )
    assert report["total"] == 2
    assert report["hits"] == 1
    assert report["hit_rate"] == 0.5


def test_local_intent_shipping():
    assert local_intent("أبغى أعرف عن الديليفري")["intent"] == "shipping"
