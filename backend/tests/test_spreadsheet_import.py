import io

import pytest
from openpyxl import Workbook

from app.services.spreadsheet import (
    get_row_value,
    parse_spreadsheet,
    parse_specs_value,
)


def _xlsx_bytes(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_parse_csv_contacts() -> None:
    content = b"phone,name,email\n+96550000001,Ali,ali@test.com\n"
    rows = parse_spreadsheet(content, "contacts.csv")
    assert len(rows) == 1
    assert get_row_value(rows[0], "phone") == "+96550000001"
    assert get_row_value(rows[0], "name") == "Ali"
    assert get_row_value(rows[0], "email") == "ali@test.com"


def test_parse_xlsx_contacts_arabic_headers() -> None:
    content = _xlsx_bytes([
        ["رقم", "اسم"],
        ["+96550000002", "Sara"],
    ])
    rows = parse_spreadsheet(content, "clients.xlsx")
    assert len(rows) == 1
    assert get_row_value(rows[0], "phone") == "+96550000002"
    assert get_row_value(rows[0], "name") == "Sara"


def test_parse_xlsx_catalog_products() -> None:
    content = _xlsx_bytes([
        ["name", "price", "currency", "product_type", "specs"],
        ["AC Unit", "120", "KWD", "product", "power: 2 ton; brand: LG"],
    ])
    rows = parse_spreadsheet(content, "catalog.xlsx")
    assert get_row_value(rows[0], "product_name") == "AC Unit"
    assert get_row_value(rows[0], "price") == "120"
    assert parse_specs_value(get_row_value(rows[0], "specs")) == {"power": "2 ton", "brand": "LG"}


def test_rejects_unknown_binary() -> None:
    with pytest.raises(ValueError, match="UNSUPPORTED_FILE_FORMAT"):
        parse_spreadsheet(b"\x00\x01\x02\x03", "file.bin")
