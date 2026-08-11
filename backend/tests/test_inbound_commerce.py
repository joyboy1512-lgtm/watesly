from app.services.inbound_commerce import (
    format_order_text,
    order_total_amount,
    parse_whatsapp_order,
)
from app.services.inbound_interactive import extract_interactive_reply
from app.services.marketing_compliance import (
    append_marketing_opt_out_components,
    is_marketing_interested_request,
)


def test_parse_whatsapp_order() -> None:
    item = {
        "type": "order",
        "order": {
            "catalog_id": "123",
            "text": "أريد التوصيل صباحاً",
            "product_items": [
                {
                    "product_retailer_id": "sku-red-m",
                    "quantity": 2,
                    "item_price": 25,
                    "currency": "KWD",
                }
            ],
        },
    }
    parsed = parse_whatsapp_order(item)
    assert parsed is not None
    assert parsed["catalog_id"] == "123"
    assert len(parsed["product_items"]) == 1


def test_format_order_text_and_total() -> None:
    order_data = {
        "text": "ملاحظة",
        "product_items": [
            {"product_retailer_id": "sku-1", "quantity": 2, "item_price": 10, "currency": "KWD"},
        ],
    }
    text = format_order_text(order_data, product_names={"sku-1": "ثوب أحمر"})
    assert "ثوب أحمر" in text
    assert "20.00 KWD" in text
    total, currency = order_total_amount(order_data)
    assert total == 20
    assert currency == "KWD"


def test_legacy_button_reply() -> None:
    result = extract_interactive_reply(
        {"type": "button", "button": {"text": "مهتم", "payload": "watesly_interested"}}
    )
    assert result is not None
    assert result["button_id"] == "watesly_interested"


def test_marketing_interested_detection() -> None:
    assert is_marketing_interested_request(button_id="watesly_interested")
    assert is_marketing_interested_request(button_title="مهتم")


def test_append_marketing_buttons_includes_interested_and_opt_out() -> None:
    components = append_marketing_opt_out_components([{"type": "BODY", "text": "عرض"}])
    buttons = next(item for item in components if item.get("type") == "BUTTONS")["buttons"]
    ids = {button.get("id") for button in buttons}
    assert "watesly_interested" in ids
    assert "watesly_marketing_opt_out" in ids
