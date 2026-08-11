from decimal import Decimal

from app.services.catalog_orders import build_line_items
from app.services.catalog_order_pdf import generate_catalog_order_invoice_pdf


def test_build_line_items() -> None:
    order_data = {
        "product_items": [
            {"product_retailer_id": "sku-1", "quantity": 2, "item_price": 5, "currency": "KWD"},
        ]
    }
    items = build_line_items(order_data, product_names={"sku-1": "Product A"})
    assert len(items) == 1
    assert items[0]["product_name"] == "Product A"
    assert items[0]["quantity"] == 2
    assert items[0]["line_total"] == "10.00"


def test_generate_invoice_pdf() -> None:
    pdf = generate_catalog_order_invoice_pdf(
        {
            "company_name": "Thre Shiny",
            "order_number": "ORD-20260811-0001",
            "created_at": None,
            "customer_name": "Customer",
            "customer_phone": "+96560000000",
            "customer_note": "Delivery morning",
            "currency": "KWD",
            "subtotal": Decimal("10.00"),
            "line_items": [
                {
                    "product_name": "Shower Gel",
                    "product_retailer_id": "sku-1",
                    "quantity": 2,
                    "unit_price": "5",
                    "currency": "KWD",
                    "line_total": "10.00",
                }
            ],
        }
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500
