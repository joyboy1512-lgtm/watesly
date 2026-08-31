import type { PermissionKey } from "./teamHelpers";

export type NavPermissionRule = PermissionKey | PermissionKey[] | null;

export type AppNavPage = {
  path: string;
  label: string;
  permission: NavPermissionRule;
  /** Match sub-routes like /contacts/:id */
  matchPrefix?: boolean;
};

/** Dashboard is always visible — excluded from permission editor. */
export const DASHBOARD_PATH = "/dashboard";

/** Sidebar pages and their required permission(s). */
export const APP_NAV_PAGES: AppNavPage[] = [
  { path: "/inbox", label: "صندوق الوارد", permission: "conversations.view", matchPrefix: true },
  { path: "/catalog", label: "المتجر", permission: "contacts.view", matchPrefix: true },
  { path: "/knowledge", label: "قاعدة المعرفة", permission: "contacts.view" },
  { path: "/contacts", label: "العملاء", permission: "contacts.view", matchPrefix: true },
  { path: "/quick-replies", label: "الردود السريعة", permission: "messages.send" },
  { path: "/crm", label: "CRM", permission: "contacts.view", matchPrefix: true },
  { path: "/analytics", label: "التحليلات", permission: "reports.view" },
  { path: "/reports", label: "التقارير", permission: "reports.view" },
  { path: "/developer", label: "منصة المطور", permission: "operations.view" },
  { path: "/team", label: "الموظفون", permission: "users.view" },
  { path: "/assignments", label: "التعيينات", permission: "conversations.assign" },
  { path: "/organizations", label: "الأفرع", permission: "organizations.view" },
  { path: "/channels", label: "القنوات", permission: "channels.view" },
  { path: "/billing", label: "الفوترة", permission: "billing.view" },
  { path: "/whatsapp-connect", label: "ربط WhatsApp", permission: "channels.manage" },
  { path: "/instagram-connect", label: "ربط Instagram", permission: "channels.manage" },
  { path: "/whatsapp-account-tools", label: "أدوات الحساب", permission: "channels.view" },
  { path: "/templates", label: "القوالب", permission: "templates.view" },
  { path: "/campaigns", label: "الحملات", permission: "campaigns.view" },
  { path: "/automations", label: "الأتمتة", permission: "automations.view" },
  { path: "/trust-center", label: "مركز الثقة", permission: "trust.view" },
  { path: "/core-health", label: "صحة النظام", permission: "operations.view" }
];

export const NAV_ITEM_PERMISSIONS: Record<string, NavPermissionRule> = Object.fromEntries(
  APP_NAV_PAGES.map((page) => [page.path, page.permission])
);

/** Extra protected routes not shown in sidebar. */
export const EXTRA_ROUTE_PERMISSIONS: Record<string, NavPermissionRule> = {
  "/admin": "operations.manage",
  "/admin/site-content": "operations.manage"
};

const ALL_ROUTE_RULES: Array<{ prefix: string; permission: NavPermissionRule; exact?: boolean }> = [
  ...APP_NAV_PAGES.map((page) => ({
    prefix: page.path,
    permission: page.permission,
    exact: !page.matchPrefix
  })),
  ...Object.entries(EXTRA_ROUTE_PERMISSIONS).map(([prefix, permission]) => ({ prefix, permission, exact: false }))
];

export function hasNavPermission(permissions: ReadonlySet<string> | string[] | undefined, rule: NavPermissionRule): boolean {
  if (rule === null) return true;
  if (!permissions) return false;
  const granted = permissions instanceof Set ? permissions : new Set(permissions);
  if (granted.size === 0) return false;
  const required = Array.isArray(rule) ? rule : [rule];
  return required.some((item) => granted.has(item));
}

export function filterNavItems<T extends readonly (readonly [string, string, string])[]>(
  items: T,
  permissions: string[] | undefined
): T[number][] {
  return items.filter(([path]) => {
    if (path === DASHBOARD_PATH) return true;
    return hasNavPermission(permissions, NAV_ITEM_PERMISSIONS[path] ?? null);
  }) as T[number][];
}

export function getRoutePermission(pathname: string): NavPermissionRule {
  if (pathname === DASHBOARD_PATH || pathname.startsWith(`${DASHBOARD_PATH}/`)) {
    return null;
  }

  const sorted = [...ALL_ROUTE_RULES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of sorted) {
    if (entry.exact) {
      if (pathname === entry.prefix) return entry.permission;
      continue;
    }
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.permission;
    }
  }
  return null;
}

export function canAccessRoute(pathname: string, permissions: string[] | undefined): boolean {
  const rule = getRoutePermission(pathname);
  if (rule === null) return true;
  return hasNavPermission(permissions, rule);
}

export function pageIsEnabled(permissions: ReadonlySet<PermissionKey>, rule: NavPermissionRule): boolean {
  if (rule === null) return true;
  const required = Array.isArray(rule) ? rule : [rule];
  return required.every((item) => permissions.has(item));
}

export function applyPageToggle(
  current: Set<PermissionKey>,
  rule: NavPermissionRule,
  enabled: boolean
): Set<PermissionKey> {
  const next = new Set(current);
  if (rule === null) return next;
  const keys = Array.isArray(rule) ? rule : [rule];
  if (enabled) keys.forEach((item) => next.add(item));
  else keys.forEach((item) => next.delete(item));
  return next;
}
