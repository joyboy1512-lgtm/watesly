from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_conversation_list_supports_engaged_only_filter() -> None:
    service = read("app/services/conversations.py")
    routes = read("app/api/routes/conversations.py")
    assert "engaged_only: bool = False" in service
    assert "MessageDirection.INBOUND" in service
    assert "aliased(Message)" in service
    assert "inbound_message = aliased(Message)" in service
    assert "engaged_only: bool = Query(" in routes
    assert "engaged_only=engaged_only" in routes


def test_engaged_only_uses_aliased_message_for_exists() -> None:
    """EXISTS must alias Message — outer join already uses Message as latest row."""
    service = read("app/services/conversations.py")
    engaged_block = service.split("if engaged_only:", 1)[1].split("if archived_only:", 1)[0]
    assert "aliased(Message)" in engaged_block
    assert "inbound_message = aliased(Message)" in engaged_block
    assert "select(Message.id)" not in engaged_block


def test_conversation_list_masking_fetches_flags_once() -> None:
    routes = read("app/api/routes/conversations.py")
    assert "async def _mask_conversation_list" in routes
    # List path must not call get_feature_flags per row.
    mask_fn = routes.split("async def _mask_conversation_list", 1)[1].split("async def ", 1)[0]
    assert mask_fn.count("get_feature_flags") == 1


def test_inbox_page_defaults_to_engaged_with_paged_limit() -> None:
    page = read("../frontend/src/pages/InboxPage.tsx")
    helpers = read("../frontend/src/lib/inboxHelpers.ts")
    assert "INBOX_CONVERSATIONS_PAGE_SIZE = 100" in helpers
    assert 'useState<InboxFilter>("engaged")' in page
    assert "engaged_only: engagedOnly" in page
    assert "limit: listLimit" in page
    assert 'filter !== "all"' in page
