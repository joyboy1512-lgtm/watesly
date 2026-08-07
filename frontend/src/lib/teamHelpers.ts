export type MembershipRole = "owner" | "admin" | "manager" | "agent" | "viewer";
export type MembershipStatus = "active" | "suspended";

export type Employee = {
  user_id: string;
  membership_id: string;
  email: string;
  full_name: string;
  role: MembershipRole;
  status: MembershipStatus;
  organization_ids: string[];
  channel_ids: string[];
};

export type Organization = { id: string; name: string };

/** WhatsApp Business account linked to the platform — the real "workspace" for team access. */
export type WhatsAppWorkspace = {
  id: string;
  channel_id: string;
  organization_id: string;
  display_phone_number: string;
  verified_name: string | null;
  status: string;
};

export type TeamStats = {
  total: number;
  active: number;
  suspended: number;
  admins: number;
  agents: number;
};

export const TEAM_PAGE_SIZE = 20;

export const INVITABLE_ROLES: MembershipRole[] = ["admin", "manager", "agent", "viewer"];

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "مالك الحساب",
  admin: "مدير النظام",
  manager: "مشرف",
  agent: "موظف",
  viewer: "مشاهد"
};

export const ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  owner: "صلاحيات كاملة بما فيها الفوترة وإدارة الحساب",
  admin: "صلاحيات كاملة ما عدا نقل ملكية الحساب",
  manager: "إدارة المحادثات والحملات والتقارير وعرض الموظفين",
  agent: "التعامل مع المحادثات والعملاء وإرسال الرسائل",
  viewer: "عرض البيانات والتقارير فقط بدون تعديل"
};

export const STATUS_LABELS: Record<MembershipStatus, string> = {
  active: "نشط",
  suspended: "موقوف"
};

export const WHATSAPP_STATUS_LABELS: Record<string, string> = {
  active: "متصل",
  pending: "قيد الربط",
  disconnected: "غير متصل",
  suspended: "موقوف"
};

export type PermissionKey =
  | "conversations.view"
  | "conversations.assign"
  | "messages.send"
  | "contacts.view"
  | "contacts.edit"
  | "channels.view"
  | "channels.manage"
  | "templates.view"
  | "templates.manage"
  | "campaigns.view"
  | "campaigns.create"
  | "campaigns.approve"
  | "automations.view"
  | "automations.edit"
  | "automations.publish"
  | "users.view"
  | "users.manage"
  | "organizations.view"
  | "organizations.manage"
  | "billing.view"
  | "billing.manage"
  | "reports.view"
  | "reports.export"
  | "files.upload"
  | "files.view"
  | "trust.view"
  | "trust.manage"
  | "operations.view"
  | "operations.manage";

export type PermissionGroup = {
  id: string;
  label: string;
  permissions: Array<{ key: PermissionKey; label: string }>;
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "conversations",
    label: "المحادثات",
    permissions: [
      { key: "conversations.view", label: "عرض المحادثات" },
      { key: "conversations.assign", label: "تعيين المحادثات" },
      { key: "messages.send", label: "إرسال الرسائل" }
    ]
  },
  {
    id: "contacts",
    label: "العملاء",
    permissions: [
      { key: "contacts.view", label: "عرض العملاء" },
      { key: "contacts.edit", label: "تعديل العملاء" }
    ]
  },
  {
    id: "channels",
    label: "القنوات",
    permissions: [
      { key: "channels.view", label: "عرض القنوات" },
      { key: "channels.manage", label: "إدارة القنوات" }
    ]
  },
  {
    id: "templates",
    label: "القوالب",
    permissions: [
      { key: "templates.view", label: "عرض القوالب" },
      { key: "templates.manage", label: "إدارة القوالب" }
    ]
  },
  {
    id: "campaigns",
    label: "الحملات",
    permissions: [
      { key: "campaigns.view", label: "عرض الحملات" },
      { key: "campaigns.create", label: "إنشاء الحملات" },
      { key: "campaigns.approve", label: "اعتماد الحملات" }
    ]
  },
  {
    id: "automations",
    label: "الأتمتة",
    permissions: [
      { key: "automations.view", label: "عرض الأتمتة" },
      { key: "automations.edit", label: "تعديل الأتمتة" },
      { key: "automations.publish", label: "نشر الأتمتة" }
    ]
  },
  {
    id: "team",
    label: "الفريق",
    permissions: [
      { key: "users.view", label: "عرض الموظفين" },
      { key: "users.manage", label: "إدارة الموظفين" }
    ]
  },
  {
    id: "organizations",
    label: "الأفرع",
    permissions: [
      { key: "organizations.view", label: "عرض الأفرع" },
      { key: "organizations.manage", label: "إدارة الأفرع" }
    ]
  },
  {
    id: "billing",
    label: "الفوترة",
    permissions: [
      { key: "billing.view", label: "عرض الفوترة" },
      { key: "billing.manage", label: "إدارة الفوترة" }
    ]
  },
  {
    id: "reports",
    label: "التقارير",
    permissions: [
      { key: "reports.view", label: "عرض التقارير" },
      { key: "reports.export", label: "تصدير التقارير" }
    ]
  },
  {
    id: "files",
    label: "الملفات",
    permissions: [
      { key: "files.view", label: "عرض الملفات" },
      { key: "files.upload", label: "رفع الملفات" }
    ]
  },
  {
    id: "trust",
    label: "الثقة والامتثال",
    permissions: [
      { key: "trust.view", label: "عرض الثقة" },
      { key: "trust.manage", label: "إدارة الثقة" }
    ]
  },
  {
    id: "operations",
    label: "العمليات",
    permissions: [
      { key: "operations.view", label: "عرض العمليات" },
      { key: "operations.manage", label: "إدارة العمليات" }
    ]
  }
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((item) => item.key));

/** Mirrors backend app/core/permissions.py ROLE_PERMISSIONS */
export const ROLE_PERMISSIONS: Record<MembershipRole, ReadonlySet<PermissionKey>> = {
  owner: new Set(ALL_PERMISSIONS),
  admin: new Set(ALL_PERMISSIONS),
  manager: new Set([
    "conversations.view",
    "conversations.assign",
    "messages.send",
    "contacts.view",
    "contacts.edit",
    "channels.view",
    "templates.view",
    "templates.manage",
    "campaigns.view",
    "campaigns.create",
    "campaigns.approve",
    "automations.view",
    "automations.edit",
    "automations.publish",
    "users.view",
    "organizations.view",
    "reports.view",
    "reports.export",
    "files.upload",
    "files.view",
    "trust.view"
  ]),
  agent: new Set([
    "conversations.view",
    "messages.send",
    "contacts.view",
    "contacts.edit",
    "channels.view",
    "templates.view",
    "campaigns.view",
    "automations.view",
    "files.upload",
    "files.view"
  ]),
  viewer: new Set([
    "conversations.view",
    "contacts.view",
    "channels.view",
    "templates.view",
    "campaigns.view",
    "automations.view",
    "organizations.view",
    "reports.view",
    "files.view",
    "trust.view"
  ])
};

export function workspaceDisplayName(workspace: Pick<WhatsAppWorkspace, "verified_name" | "display_phone_number">): string {
  return workspace.verified_name?.trim() || workspace.display_phone_number;
}

export function formatWhatsAppStatus(status: string): string {
  return WHATSAPP_STATUS_LABELS[status] ?? status;
}

export function whatsappStatusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "team-wa-status team-wa-status-active";
    case "pending":
      return "team-wa-status team-wa-status-pending";
    case "disconnected":
    case "suspended":
      return "team-wa-status team-wa-status-offline";
    default:
      return "team-wa-status";
  }
}

export function getEmployeeWorkspaces(employee: Employee, workspaces: WhatsAppWorkspace[]): WhatsAppWorkspace[] {
  if (employee.role === "owner" || employee.role === "admin") return workspaces;
  return workspaces.filter((workspace) => {
    if (!employee.organization_ids.includes(workspace.organization_id)) return false;
    if (!employee.channel_ids.length) return true;
    return employee.channel_ids.includes(workspace.channel_id);
  });
}

export function organizationIdsFromWorkspaces(workspaces: WhatsAppWorkspace[], workspaceIds: string[]): string[] {
  const selected = new Set(workspaceIds);
  return [...new Set(workspaces.filter((item) => selected.has(item.id)).map((item) => item.organization_id))];
}

export function employeeInitials(employee: Pick<Employee, "full_name" | "email">): string {
  const name = employee.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return employee.email.slice(0, 2).toUpperCase();
}

export function formatRoleLabel(role: MembershipRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function formatStatusLabel(status: MembershipStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function roleBadgeClass(role: MembershipRole): string {
  switch (role) {
    case "owner":
      return "team-role-badge team-role-owner";
    case "admin":
      return "team-role-badge team-role-admin";
    case "manager":
      return "team-role-badge team-role-manager";
    case "agent":
      return "team-role-badge team-role-agent";
    default:
      return "team-role-badge team-role-viewer";
  }
}

export function statusBadgeClass(status: MembershipStatus): string {
  return status === "active" ? "team-status-badge team-status-active" : "team-status-badge team-status-suspended";
}

export function getRolePermissions(role: MembershipRole): ReadonlySet<PermissionKey> {
  return ROLE_PERMISSIONS[role] ?? new Set();
}

export function computeTeamStats(employees: Employee[]): TeamStats {
  return {
    total: employees.length,
    active: employees.filter((item) => item.status === "active").length,
    suspended: employees.filter((item) => item.status === "suspended").length,
    admins: employees.filter((item) => item.role === "owner" || item.role === "admin").length,
    agents: employees.filter((item) => item.role === "agent").length
  };
}

export function filterEmployees(
  employees: Employee[],
  workspaces: WhatsAppWorkspace[],
  options: {
    search: string;
    role: string;
    status: string;
    workspaceId: string;
  }
): Employee[] {
  const query = options.search.trim().toLowerCase();
  return employees.filter((item) => {
    if (options.role && item.role !== options.role) return false;
    if (options.status && item.status !== options.status) return false;
    if (options.workspaceId) {
      const employeeWorkspaces = getEmployeeWorkspaces(item, workspaces);
      if (!employeeWorkspaces.some((workspace) => workspace.id === options.workspaceId)) return false;
    }
    if (!query) return true;
    const workspaceNames = getEmployeeWorkspaces(item, workspaces)
      .map((workspace) => workspaceDisplayName(workspace))
      .join(" ");
    return (
      item.full_name.toLowerCase().includes(query) ||
      item.email.toLowerCase().includes(query) ||
      formatRoleLabel(item.role).includes(query) ||
      workspaceNames.toLowerCase().includes(query)
    );
  });
}
