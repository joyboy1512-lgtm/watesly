from enum import StrEnum

from app.models.membership import MembershipRole


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


ROLE_PERMISSIONS: dict[MembershipRole, frozenset[Permission]] = {
    MembershipRole.OWNER: frozenset(Permission),
    MembershipRole.ADMIN: frozenset(Permission),
    MembershipRole.MANAGER: frozenset({
        Permission.CONVERSATIONS_VIEW, Permission.CONVERSATIONS_ASSIGN,
        Permission.MESSAGES_SEND, Permission.CONTACTS_VIEW, Permission.CONTACTS_EDIT,
        Permission.CHANNELS_VIEW, Permission.TEMPLATES_VIEW, Permission.TEMPLATES_MANAGE,
        Permission.CAMPAIGNS_VIEW, Permission.CAMPAIGNS_CREATE, Permission.CAMPAIGNS_APPROVE,
        Permission.AUTOMATIONS_VIEW, Permission.AUTOMATIONS_EDIT, Permission.AUTOMATIONS_PUBLISH,
        Permission.USERS_VIEW, Permission.ORGANIZATIONS_VIEW,
        Permission.REPORTS_VIEW, Permission.REPORTS_EXPORT,
        Permission.FILES_UPLOAD, Permission.FILES_VIEW, Permission.TRUST_VIEW,
    }),
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


def role_has_permission(role: MembershipRole, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())
