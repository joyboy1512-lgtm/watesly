"""Plan limit helpers — 0 means unlimited for organization/channel caps."""

UNLIMITED = 0


def is_unlimited(limit: int) -> bool:
    return limit <= 0


def organization_limit_reached(*, current_count: int, max_organizations: int) -> bool:
    if is_unlimited(max_organizations):
        return False
    return current_count >= max_organizations
