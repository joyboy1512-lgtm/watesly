from datetime import UTC, datetime, timedelta

from app.services.whatsapp_window import SERVICE_WINDOW_HOURS, compute_service_window


def test_compute_service_window_open() -> None:
    now = datetime.now(UTC)
    last = now - timedelta(hours=2)
    window = compute_service_window(last)
    assert window["service_window_open"] is True
    assert window["requires_template"] is False
    assert window["service_window_expires_at"] is not None


def test_compute_service_window_closed() -> None:
    now = datetime.now(UTC)
    last = now - timedelta(hours=25)
    window = compute_service_window(last)
    assert window["service_window_open"] is False
    assert window["requires_template"] is True


def test_compute_service_window_no_inbound() -> None:
    window = compute_service_window(None)
    assert window["service_window_open"] is False
    assert window["requires_template"] is True


def test_service_window_hours_constant() -> None:
    assert SERVICE_WINDOW_HOURS == 24
