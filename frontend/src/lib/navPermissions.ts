import type { PermissionKey } from "./teamHelpers";

export type NavPermissionRule = PermissionKey | PermissionKey[] | null;

/** Minimum permission(s) required to show a sidebar link. `null` = all authenticated users. */
export const NAV_ITEM_PERMISSIONS: Record<string, NavPermissionRule> = {
  "/dashboard": null,
  "/inbox": "conversations.view",
  "/catalog": "contacts.view",
  "/knowledge": "contacts.view",
  "/contacts": "contacts.view",
  "/quick-replies": "messages.send",
  "/crm": "contacts.view",
  "/analytics": "reports.view",
  "/reports": "reports.view",
  "/developer": "operations.view",
  "/team": "users.view",
  "/assignments": "conversations.assign",
  "/organizations": "organizations.view",
  "/channels": "channels.view",
  "/billing": "billing.view",
  "/whatsapp-connect": "channels.manage",
  "/templates": "templates.view",
  "/campaigns": "campaigns.view",
  "/automations": "automations.view",
  "/trust-center": "trust.view",
  "/core-health": "operations.view"
};

export function hasNavPermission(permissions: ReadonlySet<string> | string[] | undefined, rule: NavPermissionRule): boolean {
  if (rule === null) return true;
  if (!permissions) return false;
  const granted = permissions instanceof Set ? permissions : new Set(permissions);
  const required = Array.isArray(rule) ? rule : [rule];
  return required.some((item) => granted.has(item));
}

export function filterNavItems<T extends readonly (readonly [string, string, string])[]>(
  items: T,
  permissions: string[] | undefined
): T[number][] {
  return items.filter(([path]) => hasNavPermission(permissions, NAV_ITEM_PERMISSIONS[path] ?? null)) as T[number][];
}
