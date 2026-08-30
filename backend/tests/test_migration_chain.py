from pathlib import Path
import re


def test_alembic_revision_chain_is_short_and_linear() -> None:
    versions = Path(__file__).parents[1] / "alembic" / "versions"
    files = sorted(path for path in versions.glob("*.py") if path.name != ".gitkeep")
    assert files, "expected alembic versions"

    revisions: dict[str, str | None] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        revision_match = re.search(
            r'^revision(?::\s*str)?\s*=\s*"([^"]+)"',
            text,
            re.MULTILINE,
        )
        down_match = re.search(
            r'^down_revision(?::\s*str\s*\|\s*None)?\s*=\s*(None|"[^"]+")',
            text,
            re.MULTILINE,
        )
        assert revision_match, path.name
        assert down_match, path.name
        revision = revision_match.group(1)
        assert len(revision) <= 64
        assert revision not in revisions, f"duplicate revision {revision}"
        down_raw = down_match.group(1)
        down_revision = None if down_raw == "None" else down_raw.strip('"')
        revisions[revision] = down_revision

    roots = [rev for rev, down in revisions.items() if down is None]
    assert len(roots) == 1, f"expected single root revision, got {roots}"

    children: dict[str | None, list[str]] = {}
    for rev, down in revisions.items():
        children.setdefault(down, []).append(rev)
    for parent, kids in children.items():
        assert len(kids) == 1, f"branching at {parent}: {kids}"

    ordered: list[str] = []
    current: str | None = roots[0]
    while current is not None:
        ordered.append(current)
        kids = children.get(current, [])
        current = kids[0] if kids else None
    assert len(ordered) == len(revisions)
