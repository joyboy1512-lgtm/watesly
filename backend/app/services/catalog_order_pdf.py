"""Generate catalog order invoice PDF."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONT_FILE = FONT_DIR / "NotoSansArabic-Regular.ttf"


def _shape_arabic(text: str) -> str:
    if not text:
        return ""
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text))
    except Exception:
        return text


def _pdf_text(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    if any("\u0600" <= char <= "\u06FF" for char in value):
        return _shape_arabic(value)
    return value


def generate_catalog_order_invoice_pdf(context: dict[str, Any]) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    pdf.set_margins(14, 14, 14)

    font_loaded = False
    if FONT_FILE.is_file():
        try:
            pdf.add_font("NotoArabic", "", str(FONT_FILE))
            pdf.set_font("NotoArabic", size=11)
            font_loaded = True
        except Exception:
            font_loaded = False
    if not font_loaded:
        pdf.set_font("Helvetica", size=11)

    company = _pdf_text(str(context.get("company_name") or "Watesly"))
    order_number = str(context.get("order_number") or "")
    created_at: datetime | None = context.get("created_at")
    created_label = created_at.strftime("%Y-%m-%d %H:%M") if isinstance(created_at, datetime) else ""
    customer_name = _pdf_text(str(context.get("customer_name") or ""))
    customer_phone = str(context.get("customer_phone") or "")
    customer_note = _pdf_text(str(context.get("customer_note") or ""))
    currency = str(context.get("currency") or "KWD")
    subtotal = Decimal(str(context.get("subtotal") or 0))

    pdf.set_font_size(16)
    pdf.cell(0, 10, _pdf_text("فاتورة طلب كتالوج"), ln=1, align="R")
    pdf.set_font_size(11)
    pdf.cell(0, 7, company, ln=1, align="R")
    pdf.ln(2)
    pdf.cell(0, 6, _pdf_text(f"رقم الطلب: {order_number}"), ln=1, align="R")
    if created_label:
        pdf.cell(0, 6, _pdf_text(f"التاريخ: {created_label}"), ln=1, align="R")
    pdf.cell(0, 6, _pdf_text(f"العميل: {customer_name}"), ln=1, align="R")
    if customer_phone:
        pdf.cell(0, 6, f"WhatsApp: {customer_phone}", ln=1, align="L")
    pdf.ln(4)

    col_product = 95
    col_qty = 20
    col_price = 30
    col_total = 35
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(col_product, 8, _pdf_text("المنتج"), border=1, align="R", fill=True)
    pdf.cell(col_qty, 8, _pdf_text("الكمية"), border=1, align="C", fill=True)
    pdf.cell(col_price, 8, _pdf_text("السعر"), border=1, align="C", fill=True)
    pdf.cell(col_total, 8, _pdf_text("الإجمالي"), border=1, align="C", fill=True, ln=1)

    for item in context.get("line_items") or []:
        name = _pdf_text(str(item.get("product_name") or item.get("product_retailer_id") or ""))
        qty = str(item.get("quantity") or 1)
        unit_price = item.get("unit_price")
        line_total = item.get("line_total")
        price_label = f"{unit_price} {currency}" if unit_price is not None else "—"
        total_label = f"{line_total} {currency}" if line_total is not None else "—"
        pdf.cell(col_product, 8, name[:70], border=1, align="R")
        pdf.cell(col_qty, 8, qty, border=1, align="C")
        pdf.cell(col_price, 8, price_label, border=1, align="C")
        pdf.cell(col_total, 8, total_label, border=1, align="C", ln=1)

    pdf.ln(3)
    pdf.set_font_size(12)
    pdf.cell(0, 8, _pdf_text(f"الإجمالي: {subtotal:.2f} {currency}"), ln=1, align="R")
    if customer_note:
        pdf.ln(2)
        pdf.set_font_size(10)
        pdf.multi_cell(0, 6, _pdf_text(f"ملاحظة العميل: {customer_note}"), align="R")

    buffer = BytesIO()
    pdf.output(buffer)
    return buffer.getvalue()
