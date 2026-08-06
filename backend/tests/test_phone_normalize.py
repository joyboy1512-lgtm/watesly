"""Tests for WhatsApp phone normalization."""

from app.services.phone_normalize import normalize_whatsapp_phone


def test_kuwait_local_to_e164():
    assert normalize_whatsapp_phone("0501234567", country_code="965") == "965501234567"


def test_strips_plus_and_spaces():
    assert normalize_whatsapp_phone("+965 5012 3456", country_code="965") == "96550123456"


def test_already_international():
    assert normalize_whatsapp_phone("96550123456", country_code="965") == "96550123456"
