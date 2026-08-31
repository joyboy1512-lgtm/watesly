from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_archive_channel_service_exists() -> None:
    service = read("app/services/channels.py")
    assert "async def archive_channel" in service
    assert "channel.deleted_at = now" in service
    assert "WhatsAppAccountStatus.DISCONNECTED" in service
    assert "ensure_membership_channel_access" in service


def test_whatsapp_list_hides_archived_channels() -> None:
    whatsapp = read("app/services/whatsapp.py")
    assert "Channel.deleted_at.is_(None)" in whatsapp


def test_archive_channel_route_exists() -> None:
    routes = read("app/api/routes/channels.py")
    assert '/{channel_id}/archive' in routes
    assert "post_archive_channel" in routes
    assert "Permission.CHANNELS_MANAGE" in routes


def test_channels_page_has_archive_action() -> None:
    page = read("../frontend/src/pages/ChannelsPage.tsx")
    assert "archiveChannel" in page
    assert "/channels/${channel.channel_id}/archive" in page
    assert "أرشفة" in page
