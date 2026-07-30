import pytest
from app.core.file_security import sanitize_filename, validate_file_content


def test_sanitize_filename_blocks_traversal() -> None:
    assert sanitize_filename("../../secret.pdf") == "secret.pdf"


def test_pdf_signature_validation() -> None:
    assert validate_file_content("x.pdf", "application/pdf", b"%PDF-1.7") == "application/pdf"


def test_rejects_mismatched_signature() -> None:
    with pytest.raises(ValueError):
        validate_file_content("x.pdf", "application/pdf", b"not a pdf")
