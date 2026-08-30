from app.services.whatsapp_account_tools import (
    PRICING_CATEGORY_LABELS_AR,
    summarize_call_points,
    summarize_pricing_points,
)


def test_summarize_pricing_points_groups_categories_and_types() -> None:
    points = [
        {
            "pricing_category": "MARKETING",
            "pricing_type": "REGULAR",
            "volume": 337,
            "cost": 11.51,
        },
        {
            "pricing_category": "SERVICE",
            "pricing_type": "FREE_CUSTOMER_SERVICE",
            "volume": 13,
            "cost": 0,
        },
        {
            "pricing_category": "MARKETING",
            "pricing_type": "REGULAR",
            "volume": 10,
            "cost": 0.4,
        },
    ]
    summary = summarize_pricing_points(points)
    assert summary["delivered_total"] == 360
    assert summary["delivered_free"] == 13
    assert summary["delivered_paid"] == 347
    assert round(summary["approximate_cost"], 2) == 11.91
    assert summary["by_category"][0]["key"] == "MARKETING"
    assert summary["by_category"][0]["volume"] == 347
    assert summary["by_category"][0]["label_ar"] == PRICING_CATEGORY_LABELS_AR["MARKETING"]
    free = next(row for row in summary["by_pricing_type"] if row["key"] == "FREE_CUSTOMER_SERVICE")
    assert free["volume"] == 13


def test_summarize_call_points() -> None:
    points = [
        {"count": 4, "cost": 1.2, "average_duration": 30, "direction": "BUSINESS_INITIATED", "call_type": "VOICE"},
        {"count": 2, "cost": 0.5, "average_duration": 45, "direction": "USER_INITIATED", "call_type": "VOICE"},
    ]
    summary = summarize_call_points(points)
    assert summary["calls_total"] == 6
    assert round(summary["approximate_cost"], 2) == 1.7
    assert summary["average_duration_seconds"] == 35.0
    assert summary["by_direction"][0]["key"] == "BUSINESS_INITIATED"
