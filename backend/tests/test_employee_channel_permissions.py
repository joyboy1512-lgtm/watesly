from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_membership_access_resolver_exists() -> None:
    access = read("app/services/membership_access.py")
    channels = read("app/services/membership_channels.py")
    assert "resolve_accessible_channel_ids" in access
    assert "filter_organizations_for_membership" in access
    assert "organization_scope_clauses" in access
    assert "resolve_membership_organizations" in access
    assert "Channel.organization_id.in_(organization_ids)" in channels


def test_branch_admin_role_defined() -> None:
    permissions = read("app/core/permissions.py")
    membership = read("app/models/membership.py")
    team = read("app/services/team.py")
    assert "BRANCH_ADMIN" in membership
    assert "MembershipRole.BRANCH_ADMIN" in permissions
    assert "BRANCH_ADMIN_ASSIGNABLE_PERMISSIONS" in permissions
    assert "BRANCH_SCOPED_ROLES" in team


def test_team_persists_channel_access() -> None:
    team = read("app/services/team.py")
    schema = read("app/schemas/team.py")
    routes = read("app/api/routes/team.py")

    assert "channel_ids" in schema
    assert "_apply_membership_channel_access" in team
    assert "InvitationChannelAccess" in team
    assert "INVALID_CHANNEL" in routes
    assert "permissions" in schema


def test_channel_access_enforced_on_core_routes() -> None:
    orgs = read("app/api/routes/organizations.py")
    channels = read("app/api/routes/channels.py")
    whatsapp = read("app/api/routes/whatsapp.py")
    contacts = read("app/api/routes/contacts.py")
    campaigns = read("app/api/routes/campaigns.py")
    templates = read("app/api/routes/templates.py")
    catalog = read("app/api/routes/catalog.py")
    automations = read("app/api/routes/automations.py")
    platform = read("app/api/routes/platform.py")
    inbox_tools = read("app/api/routes/inbox_tools.py")
    auth = read("app/api/routes/auth.py")
    page = read("../frontend/src/pages/TeamPage.tsx")
    layout = read("../frontend/src/components/AppLayout.tsx")

    assert "filter_organizations_for_membership" in orgs
    assert "filter_channels_for_membership" in channels
    assert "resolve_accessible_channel_ids" in whatsapp
    assert "accessible_channel_ids" in contacts
    assert "membership=context.membership" in campaigns
    assert "membership=context.membership" in templates
    assert "membership=context.membership" in catalog
    assert "membership=context.membership" in automations
    assert "membership=context.membership" in platform
    assert "membership=context.membership" in inbox_tools
    assert "branch_name" in auth
    assert "inviteableRolesForActor" in page
    assert "branch_name" in layout


def test_campaign_template_access_helpers_exist() -> None:
    access = read("app/services/membership_access.py")
    campaigns = read("app/services/campaigns.py")
    templates = read("app/services/templates.py")

    assert "ensure_campaign_access" in access
    assert "ensure_template_access" in access
    assert "campaign_list_filters" in access
    assert "template_list_filters" in access
    assert "campaign_list_filters" in campaigns
    assert "template_list_filters" in templates
    assert "membership: Membership | None = None" in campaigns
