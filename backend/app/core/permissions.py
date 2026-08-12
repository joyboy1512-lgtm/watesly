from enum import StrEnum

from app.models.membership import Membership, MembershipRole


class Permission(StrEnum):
    CONVERSATIONS_VIEW = "conversations.view"
    CONVERSATIONS_ASSIGN = "conversations.assign"
    MESSAGES_SEND = "messages.send"
    CONTACTS_VIEW = "contacts.view"
    CONTACTS_EDIT = "contacts.edit"
    CHANNELS_VIEW = "channels.view"
    CHANNELS_MANAGE = "channels.manage"
    TEMPLATES_VIEW = "templates.view"
    TEMPLATES_MANAGE = "templates.manage"
    CAMPAIGNS_VIEW = "campaigns.view"
    CAMPAIGNS_CREATE = "campaigns.create"
    CAMPAIGNS_APPROVE = "campaigns.approve"
    AUTOMATIONS_VIEW = "automations.view"
    AUTOMATIONS_EDIT = "automations.edit"
    AUTOMATIONS_PUBLISH = "automations.publish"
    USERS_VIEW = "users.view"
    USERS_MANAGE = "users.manage"
    ORGANIZATIONS_VIEW = "organizations.view"
    ORGANIZATIONS_MANAGE = "organizations.manage"
    BILLING_VIEW = "billing.view"
    BILLING_MANAGE = "billing.manage"
    REPORTS_VIEW = "reports.view"
    REPORTS_EXPORT = "reports.export"
    FILES_UPLOAD = "files.upload"
    FILES_VIEW = "files.view"
    TRUST_VIEW = "trust.view"
    TRUST_MANAGE = "trust.manage"
    OPERATIONS_VIEW = "operations.view"
    OPERATIONS_MANAGE = "operations.manage"


_BRANCH_OPS = frozenset({
    Permission.CONVERSATIONS_VIEW, Permission.CONVERSATIONS_ASSIGN,
    Permission.MESSAGES_SEND, Permission.CONTACTS_VIEW, Permission.CONTACTS_EDIT,
    Permission.CHANNELS_VIEW, Permission.TEMPLATES_VIEW, Permission.TEMPLATES_MANAGE,
    Permission.CAMPAIGNS_VIEW, Permission.CAMPAIGNS_CREATE, Permission.CAMPAIGNS_APPROVE,
    Permission.AUTOMATIONS_VIEW, Permission.AUTOMATIONS_EDIT, Permission.AUTOMATIONS_PUBLISH,
    Permission.USERS_VIEW, Permission.USERS_MANAGE, Permission.ORGANIZATIONS_VIEW,
    Permission.REPORTS_VIEW, Permission.REPORTS_EXPORT,
    Permission.FILES_UPLOAD, Permission.FILES_VIEW, Permission.TRUST_VIEW,
})

ROLE_PERMISSIONS: dict[MembershipRole, frozenset[Permission]] = {
    MembershipRole.OWNER: frozenset(Permission),
    MembershipRole.ADMIN: frozenset(Permission),
    MembershipRole.BRANCH_ADMIN: _BRANCH_OPS | frozenset({
        Permission.CHANNELS_MANAGE,
        Permission.ORGANIZATIONS_MANAGE,
        Permission.TRUST_MANAGE,
    }),
    MembershipRole.MANAGER: frozenset(_BRANCH_OPS),
    MembershipRole.AGENT: frozenset({
        Permission.CONVERSATIONS_VIEW, Permission.MESSAGES_SEND,
        Permission.CONTACTS_VIEW, Permission.CONTACTS_EDIT,
        Permission.CHANNELS_VIEW, Permission.TEMPLATES_VIEW,
        Permission.CAMPAIGNS_VIEW, Permission.AUTOMATIONS_VIEW,
        Permission.FILES_UPLOAD, Permission.FILES_VIEW,
    }),
    MembershipRole.VIEWER: frozenset({
        Permission.CONVERSATIONS_VIEW, Permission.CONTACTS_VIEW,
        Permission.CHANNELS_VIEW, Permission.TEMPLATES_VIEW,
        Permission.CAMPAIGNS_VIEW, Permission.AUTOMATIONS_VIEW,
        Permission.ORGANIZATIONS_VIEW, Permission.REPORTS_VIEW,
        Permission.FILES_VIEW, Permission.TRUST_VIEW,
    }),
}

MANAGER_ASSIGNABLE_PERMISSIONS = frozenset(ROLE_PERMISSIONS[MembershipRole.MANAGER])
BRANCH_ADMIN_ASSIGNABLE_PERMISSIONS = frozenset(ROLE_PERMISSIONS[MembershipRole.BRANCH_ADMIN])

BRANCH_SCOPED_ROLES = frozenset({
    MembershipRole.MANAGER,
    MembershipRole.BRANCH_ADMIN,
})

ROLE_RANK: dict[MembershipRole, int] = {
    MembershipRole.VIEWER: 1,
    MembershipRole.AGENT: 2,
    MembershipRole.MANAGER: 3,
    MembershipRole.BRANCH_ADMIN: 4,
    MembershipRole.ADMIN: 5,
    MembershipRole.OWNER: 6,
}


def role_has_permission(role: MembershipRole, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())


def role_permissions(role: MembershipRole) -> frozenset[Permission]:
    return ROLE_PERMISSIONS.get(role, frozenset())


def parse_permission_values(values: list[str]) -> frozenset[Permission]:
    parsed: set[Permission] = set()
    for value in values:
        try:
            parsed.add(Permission(value))
        except ValueError as exc:
            raise ValueError("INVALID_PERMISSION") from exc
    return frozenset(parsed)


def get_effective_permissions(membership: Membership) -> frozenset[Permission]:
    role_perms = role_permissions(membership.role)
    if membership.custom_permissions:
        custom = parse_permission_values(list(membership.custom_permissions))
        return custom & role_perms
    return role_perms


def membership_has_permission(membership: Membership, permission: Permission) -> bool:
    return permission in get_effective_permissions(membership)


def validate_custom_permissions_for_role(
    role: MembershipRole,
    permissions: list[str],
    *,
    assignable: frozenset[Permission] | None = None,
) -> list[str]:
    parsed = parse_permission_values(permissions)
    role_perms = role_permissions(role)
    if not parsed.issubset(role_perms):
        raise ValueError("PERMISSION_EXCEEDS_ROLE")
    if assignable is not None and not parsed.issubset(assignable):
        raise ValueError("PERMISSION_NOT_ASSIGNABLE")
    return sorted(item.value for item in parsed)


def permissions_for_response(membership: Membership) -> list[str]:
    return sorted(item.value for item in get_effective_permissions(membership))
