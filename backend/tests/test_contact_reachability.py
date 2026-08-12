from app.models.contact import Contact
from app.services.contact_reachability import (
    ReachabilityStatus,
    classify_delivery_error,
    is_contact_campaign_eligible,
    is_phone_valid_for_whatsapp,
)


def test_classify_meta_ecosystem_error_as_unreachable() -> None:
    assert (
        classify_delivery_error("This message was not delivered to maintain healthy ecosystem engagement")
        == ReachabilityStatus.UNREACHABLE
    )


def test_classify_invalid_phone_as_unreachable() -> None:
    assert classify_delivery_error("Invalid phone number") == ReachabilityStatus.UNREACHABLE


def test_unreachable_contact_excluded_from_campaign() -> None:
    contact = Contact(
        external_address="96566284005",
        country_code="KW",
        marketing_opt_in=True,
        reachability_status=ReachabilityStatus.UNREACHABLE,
    )
    assert not is_contact_campaign_eligible(contact, exclude_unreachable=True)


def test_warm_reachable_contact_is_eligible() -> None:
    contact = Contact(
        external_address="96590053224",
        country_code="KW",
        marketing_opt_in=True,
        reachability_status=ReachabilityStatus.REACHABLE,
        last_inbound_at=None,
    )
    assert is_contact_campaign_eligible(contact, exclude_unreachable=True, exclude_risky=False)


def test_cold_contact_excluded_when_exclude_risky() -> None:
    contact = Contact(
        external_address="96566280852",
        country_code="KW",
        marketing_opt_in=True,
        reachability_status=None,
        last_inbound_at=None,
    )
    assert not is_contact_campaign_eligible(contact, exclude_unreachable=True, exclude_risky=True)


def test_invalid_phone_not_eligible() -> None:
    contact = Contact(external_address="abc", country_code="KW", marketing_opt_in=True)
    assert not is_phone_valid_for_whatsapp(contact)
    assert not is_contact_campaign_eligible(contact)
