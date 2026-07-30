from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_contacts_export_route_uses_contacts_view_permission() -> None:
    routes = read("app/api/routes/contacts.py")
    export_block = routes.split('@router.get("/export")', 1)[1].split("@router.", 1)[0]
    assert "Permission.CONTACTS_VIEW" in export_block
    assert "Permission.REPORTS_EXPORT" not in export_block


def test_contacts_export_helpers_exist() -> None:
    service = read("app/services/contact_management.py")
    frontend = read("../frontend/src/lib/contactHelpers.ts")
    page = read("../frontend/src/pages/ContactsPage.tsx")
    assert "export_contacts_xlsx" in service
    assert "gender" in service
    assert "downloadContactsExport" in frontend
    assert "handleExportAll" in page
    assert "handleExportSelected" in page


def test_openpyxl_available_for_contacts_export() -> None:
    from openpyxl import Workbook

    assert Workbook is not None
