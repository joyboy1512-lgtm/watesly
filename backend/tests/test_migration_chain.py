from pathlib import Path
import re


def test_alembic_revision_chain_is_short_and_linear() -> None:
    versions = Path(__file__).parents[1] / "alembic" / "versions"
    files = sorted(path for path in versions.glob("*.py") if path.name != ".gitkeep")
    expected_down = None

    for index, path in enumerate(files, start=1):
        text = path.read_text(encoding="utf-8")
        revision_match = re.search(r'^revision: str = "([^"]+)"', text, re.MULTILINE)
        assert revision_match, path.name
        revision = revision_match.group(1)
        assert revision == f"{index:04d}"
        assert len(revision) <= 32

        if expected_down is None:
            assert "down_revision: str | None = None" in text
        else:
            assert f'down_revision: str | None = "{expected_down}"' in text
        expected_down = revision
