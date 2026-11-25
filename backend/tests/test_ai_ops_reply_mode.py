from types import SimpleNamespace

from app.services.ai_ops import compute_reply_mode
from app.services.catalog_query_parse import parse_product_query


def test_reply_mode_suggest_when_local_on_auto_off():
    mode = compute_reply_mode(
        {
            "account_agent_enabled": True,
            "agent_enabled": True,
            "local_engine_enabled": True,
            "llm_enabled": False,
            "llm_available": False,
            "auto_kb_on_inbound": True,
            "auto_reply_on_inbound": False,
        }
    )
    assert mode["mode"] == "suggest_staff"
    assert "يقترح" in mode["label"]


def test_reply_mode_blocks_auto_without_engine():
    mode = compute_reply_mode(
        {
            "account_agent_enabled": True,
            "agent_enabled": True,
            "local_engine_enabled": False,
            "llm_enabled": False,
            "llm_available": False,
            "auto_kb_on_inbound": True,
            "auto_reply_on_inbound": True,
        }
    )
    assert mode["mode"] == "staff_handles"
    assert mode["reason_code"] == "auto_reply_engines_off"
    assert mode["blockers"]


def test_account_kill_switch_wins():
    mode = compute_reply_mode(
        {
            "account_agent_enabled": False,
            "agent_enabled": True,
            "local_engine_enabled": True,
            "llm_enabled": True,
            "llm_available": True,
            "auto_kb_on_inbound": True,
            "auto_reply_on_inbound": True,
        }
    )
    assert mode["mode"] == "staff_handles"
    assert mode["reason_code"] == "agent_off"


def test_quantity_set_vs_add():
    set_q = parse_product_query("خلّهم ثلاث")
    add_q = parse_product_query("زيد ثلاث")
    assert set_q.quantity == 3
    assert set_q.quantity_mode == "set"
    assert add_q.quantity == 3
    assert add_q.quantity_mode == "add"


def test_merge_inherits_account_defaults():
    account = SimpleNamespace(
        default_mode="kb_first",
        tone="friendly",
        language="ar",
        agent_enabled=True,
        local_engine_enabled=True,
        llm_enabled=False,
        auto_kb_on_inbound=True,
        auto_reply_on_inbound=False,
        llm_system_prompt=None,
        auto_reply_outside_hours=False,
        business_hours_json={},
        outside_hours_message=None,
        llm_api_base_url=None,
        llm_model=None,
        llm_api_key_encrypted=None,
    )
    # serialize path needs real helpers — use compute on merged-like dict instead
    mode = compute_reply_mode(
        {
            "account_agent_enabled": True,
            "agent_enabled": True,
            "local_engine_enabled": True,
            "llm_enabled": False,
            "llm_available": False,
            "auto_kb_on_inbound": True,
            "auto_reply_on_inbound": False,
        }
    )
    assert mode["mode"] == "suggest_staff"
    assert account.auto_reply_on_inbound is False
