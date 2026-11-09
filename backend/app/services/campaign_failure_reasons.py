"""Classify campaign recipient failures for selective retry."""

from __future__ import annotations

from collections import defaultdict
from enum import StrEnum


class CampaignFailureReason(StrEnum):
    UNREACHABLE = "unreachable"
    INVALID_PHONE = "invalid_phone"
    RATE_LIMIT = "rate_limit"
    OPT_OUT = "opt_out"
    TEMPLATE_POLICY = "template_policy"
    OTHER = "other"


FAILURE_REASON_LABELS_AR: dict[str, str] = {
    CampaignFailureReason.UNREACHABLE: "غير قابل للوصول / الرقم غير على WhatsApp",
    CampaignFailureReason.INVALID_PHONE: "رقم غير صالح",
    CampaignFailureReason.RATE_LIMIT: "حد الإرسال / مؤقت (قابل لإعادة المحاولة)",
    CampaignFailureReason.OPT_OUT: "عدم الإزعاج / رفض التسويق",
    CampaignFailureReason.TEMPLATE_POLICY: "القالب / سياسة Meta",
    CampaignFailureReason.OTHER: "سبب آخر",
}

_UNREACHABLE = (
    "healthy ecosystem engagement",
    "not on whatsapp",
    "no longer on whatsapp",
    "131026",
    "131049",
    "recipient not valid",
    "undeliverable",
    "message undeliverable",
)
_INVALID_PHONE = (
    "invalid phone",
    "invalid phone number",
    "phone number",
)
_RATE_LIMIT = (
    "rate limit",
    "temporarily",
    "try again",
    "throttl",
    "131000",
    "80007",
)
_OPT_OUT = (
    "opt-out",
    "opt out",
    "marketing opt-out",
    "عدم الإزعاج",
)
_TEMPLATE_POLICY = (
    "template",
    "parameter",
    "re-engagement",
    "spam",
    "policy",
    "132000",
    "132001",
    "132005",
    "132012",
    "132015",
    "132016",
)


def classify_campaign_failure(error_message: str | None) -> CampaignFailureReason:
    normalized = (error_message or "").strip().lower()
    if not normalized:
        return CampaignFailureReason.OTHER
    if any(p in normalized for p in _OPT_OUT):
        return CampaignFailureReason.OPT_OUT
    if any(p in normalized for p in _INVALID_PHONE) and "whatsapp" not in normalized:
        # Prefer unreachable when Meta says not on WhatsApp
        if any(p in normalized for p in _UNREACHABLE):
            return CampaignFailureReason.UNREACHABLE
        return CampaignFailureReason.INVALID_PHONE
    if any(p in normalized for p in _UNREACHABLE):
        return CampaignFailureReason.UNREACHABLE
    if any(p in normalized for p in _RATE_LIMIT):
        return CampaignFailureReason.RATE_LIMIT
    if any(p in normalized for p in _TEMPLATE_POLICY):
        return CampaignFailureReason.TEMPLATE_POLICY
    return CampaignFailureReason.OTHER


def failure_reason_label(reason: str | CampaignFailureReason) -> str:
    key = reason.value if isinstance(reason, CampaignFailureReason) else str(reason)
    return FAILURE_REASON_LABELS_AR.get(key, FAILURE_REASON_LABELS_AR[CampaignFailureReason.OTHER])


def group_failed_recipients(
    rows: list[tuple[object, str | None]],
) -> list[dict]:
    """rows: list of (recipient_id, error_message)."""
    buckets: dict[str, dict] = {}
    samples: dict[str, set[str]] = defaultdict(set)
    for recipient_id, error_message in rows:
        reason = classify_campaign_failure(error_message)
        key = reason.value
        if key not in buckets:
            buckets[key] = {
                "reason_key": key,
                "label": failure_reason_label(reason),
                "count": 0,
                "sample_errors": [],
            }
        buckets[key]["count"] += 1
        text = (error_message or "").strip()
        if text and text not in samples[key] and len(samples[key]) < 5:
            samples[key].add(text)
    for key, bucket in buckets.items():
        bucket["sample_errors"] = sorted(samples[key])
    order = [
        CampaignFailureReason.RATE_LIMIT.value,
        CampaignFailureReason.TEMPLATE_POLICY.value,
        CampaignFailureReason.OTHER.value,
        CampaignFailureReason.INVALID_PHONE.value,
        CampaignFailureReason.UNREACHABLE.value,
        CampaignFailureReason.OPT_OUT.value,
    ]
    return sorted(
        buckets.values(),
        key=lambda item: (order.index(item["reason_key"]) if item["reason_key"] in order else 99, -item["count"]),
    )
