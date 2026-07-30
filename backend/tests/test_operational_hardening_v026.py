from pathlib import Path
import tomllib
import yaml

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_start_and_worker_are_guarded() -> None:
    service = read("app/services/campaigns.py")
    worker = read("app/workers/campaign_tasks.py")
    assert "with_for_update()" in service
    assert "execution_token" in service
    assert "execution_token" in worker
    assert "Delivery state unknown" in worker
    assert "with_for_update(skip_locked=True)" in worker


def test_automation_does_not_report_fake_success() -> None:
    worker = read("app/workers/automation_tasks.py")
    assert '"accepted": True' not in worker
    assert "Unsupported action node" in worker
    assert "send_text_message" in worker
    assert "Automation trigger is missing" in worker


def test_realtime_listener_reconnects_and_deduplicates() -> None:
    source = read("app/realtime/event_bus.py")
    assert "while True" in source
    assert "reconnecting" in source
    assert "nx=True" in source


def test_refresh_rotation_uses_lock_and_family_reuse_detection() -> None:
    source = read("app/services/auth.py")
    assert "with_for_update()" in source
    assert "family_id" in source
    assert "reuse_detected_at" in source
    assert "replaced_by_session_id" in source


def test_compose_pins_storage_and_persists_redis() -> None:
    for filename in ("compose.yaml", "compose.prod.yaml"):
        data = yaml.safe_load(read(filename))
        assert data["services"]["minio"]["image"] != "minio/minio:latest"
        assert "watesly_redis_data:/data" in data["services"]["redis"]["volumes"]
        assert "watesly_redis_data" in data["volumes"]


def test_version_is_consistent() -> None:
    project = tomllib.loads(read("pyproject.toml"))
    assert project["project"]["version"] == "0.28.0"
    assert 'app_version: str = "0.28.0"' in read("app/core/config.py")
    assert "settings.app_version" in read("app/main.py")
