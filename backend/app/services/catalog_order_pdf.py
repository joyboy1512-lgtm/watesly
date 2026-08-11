"""Generate catalog order invoice PDF."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONT_FILE = FONT_DIR / "NotoSansArabic-Regular.ttf"

ARABIC_FONT = "NotoArabic"
LATIN_FONT = "Helvetica"


def _has_arabic(text: str) -> bool:
    return any("\u0600" <= char <= "\u06FF" for char in text)


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
    if _has_arabic(value):
        return _shape_arabic(value)
    return value


def _load_fonts(pdf: Any) -> bool:
    if not FONT_FILE.is_file():
        return False
    try:
        pdf.add_font(ARABIC_FONT, "", str(FONT_FILE))
        return True
    except Exception:
        return False


def _set_font(pdf: Any, *, size: int, arabic: bool, arabic_loaded: bool) -> None:
    if arabic and arabic_loaded:
        pdf.set_font(ARABIC_FONT, size=size)
    else:
        pdf.set_font(LATIN_FONT, size=size)


def _cell_arabic(pdf: Any, w: float, h: float, text: str, *, size: int, arabic_loaded: bool, **kwargs: Any) -> None:
    _set_font(pdf, size=size, arabic=True, arabic_loaded=arabic_loaded)
    pdf.cell(w, h, _pdf_text(text), **kwargs)


def _cell_latin(pdf: Any, w: float, h: float, text: str, *, size: int, **kwargs: Any) -> None:
    _set_font(pdf, size=size, arabic=False, arabic_loaded=False)
    pdf.cell(w, h, str(text or ""), **kwargs)


def _row_label_value(
    pdf: Any,
    label: str,
    value: str,
    *,
    size: int,
    arabic_loaded: bool,
    ln: int = 1,
) -> None:
    label_width = 45
    value_width = pdf.w - pdf.l_margin - pdf.r_margin - label_width
    _cell_arabic(pdf, label_width, 6, label, size=size, arabic_loaded=arabic_loaded, align="R")
    if _has_arabic(value):
        _cell_arabic(pdf, value_width, 6, value, size=size, arabic_loaded=arabic_loaded, align="R", ln=ln)
    else:
        _cell_latin(pdf, value_width, 6, value, size=size, align="R", ln=ln)


def generate_catalog_order_invoice_pdf(context: dict[str, Any]) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    pdf.set_margins(14, 14, 14)

    arabic_loaded = _load_fonts(pdf)

    company = str(context.get("company_name") or "Watesly")
    order_number = str(context.get("order_number") or "")
    created_at: datetime | None = context.get("created_at")
    created_label = created_at.strftime("%Y-%m-%d %H:%M") if isinstance(created_at, datetime) else ""
    customer_name = str(context.get("customer_name") or "")
    customer_phone = str(context.get("customer_phone") or "")
    customer_note = str(context.get("customer_note") or "")
    currency = str(context.get("currency") or "KWD")
    subtotal = Decimal(str(context.get("subtotal") or 0))

    _cell_arabic(pdf, 0, 10, "فاتورة طلب كتالوج", size=16, arabic_loaded=arabic_loaded, ln=1, align="R")
    if _has_arabic(company):
        _cell_arabic(pdf, 0, 7, company, size=11, arabic_loaded=arabic_loaded, ln=1, align="R")
    else:
        _cell_latin(pdf, 0, 7, company, size=11, ln=1, align="R")
    pdf.ln(2)

    _row_label_value(pdf, "رقم الطلب", order_number, size=11, arabic_loaded=arabic_loaded)
    if created_label:
        _row_label_value(pdf, "التاريخ", created_label, size=11, arabic_loaded=arabic_loaded)
    if customer_name:
        _row_label_value(pdf, "العميل", customer_name, size=11, arabic_loaded=arabic_loaded)
    if customer_phone:
        _cell_latin(pdf, 0, 6, f"WhatsApp: {customer_phone}", size=11, ln=1, align="L")
    pdf.ln(4)

    col_product = 95
    col_qty = 20
    col_price = 30
    col_total = 35
    pdf.set_fill_color(240, 240, 240)
    _cell_arabic(
        pdf, col_product, 8, "المنتج", size=11, arabic_loaded=arabic_loaded, border=1, align="R", fill=True
    )
    _cell_arabic(pdf, col_qty, 8, "الكمية", size=11, arabic_loaded=arabic_loaded, border=1, align="C", fill=True)
    _cell_arabic(pdf, col_price, 8, "السعر", size=11, arabic_loaded=arabic_loaded, border=1, align="C", fill=True)
    _cell_arabic(
        pdf, col_total, 8, "الإجمالي", size=11, arabic_loaded=arabic_loaded, border=1, align="C", fill=True, ln=1
    )

    for item in context.get("line_items") or []:
        name = str(item.get("product_name") or item.get("product_retailer_id") or "")
        qty = str(item.get("quantity") or 1)
        unit_price = item.get("unit_price")
        line_total = item.get("line_total")
        price_label = f"{unit_price} {currency}" if unit_price is not None else "—"
        total_label = f"{line_total} {currency}" if line_total is not None else "—"
        if _has_arabic(name):
            _cell_arabic(pdf, col_product, 8, name[:70], size=11, arabic_loaded=arabic_loaded, border=1, align="R")
        else:
            _cell_latin(pdf, col_product, 8, name[:70], size=11, border=1, align="R")
        _cell_latin(pdf, col_qty, 8, qty, size=11, border=1, align="C")
        _cell_latin(pdf, col_price, 8, price_label, size=11, border=1, align="C")
        _cell_latin(pdf, col_total, 8, total_label, size=11, border=1, align="C", ln=1)

    pdf.ln(3)
    _row_label_value(
        pdf,
        "الإجمالي",
        f"{subtotal:.2f} {currency}",
        size=12,
        arabic_loaded=arabic_loaded,
    )
    if customer_note:
        pdf.ln(2)
        _set_font(pdf, size=10, arabic=True, arabic_loaded=arabic_loaded)
        pdf.multi_cell(0, 6, _pdf_text(f"ملاحظة العميل: {customer_note}"), align="R")

    buffer = BytesIO()
    pdf.output(buffer)
    return buffer.getvalue()
