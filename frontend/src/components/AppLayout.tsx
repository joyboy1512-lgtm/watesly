import { useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authStore } from "../stores/auth";
import { themeStore } from "../stores/theme";
import { useTheme } from "../hooks/useTheme";
import { useCurrentUser } from "../hooks/usePermissions";
import Icon from "./Icon";
import NotificationMenu from "./NotificationMenu";
import LanguageSwitcher from "./LanguageSwitcher";
import BrandLogo from "./BrandLogo";
import RequirePermission from "./RequirePermission";
import { filterNavItems, hasNavPermission } from "../lib/navPermissions";
import { formatRoleLabel, type MembershipRole } from "../lib/teamHelpers";

export default function AppLayout() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const location = useLocation();
  const isInboxRoute = location.pathname.startsWith("/inbox");
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = useCurrentUser();
  const displayName = profile.data?.full_name ?? "Watesly User";
  const branchSubtitle = profile.data?.branch_name?.trim() || t("shell.brandTagline");
  const roleSubtitle = profile.data?.is_super_admin
    ? t("shell.superAdmin")
    : profile.data?.role
      ? formatRoleLabel(profile.data.role as MembershipRole)
      : t("shell.member");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "W";

  const mainItems = [
    ["/dashboard", t("nav.dashboard"), "dashboard"],
    ["/inbox", t("nav.inbox"), "inbox"],
    ["/catalog", t("nav.catalog"), "template"],
    ["/knowledge", t("nav.knowledge"), "template"],
    ["/contacts", t("nav.contacts"), "inbox"],
    ["/quick-replies", t("nav.quickReplies"), "template"],
    ["/crm", t("nav.crm"), "organization"],
    ["/analytics", t("nav.analytics"), "dashboard"],
    ["/reports", t("nav.reports"), "template"],
    ["/developer", t("nav.developer"), "admin"],
    ["/team", t("nav.team"), "team"],
    ["/assignments", t("nav.assignments"), "channel"],
    ["/organizations", t("nav.organizations"), "organization"],
    ["/channels", t("nav.channels"), "channel"],
    ["/billing", t("nav.billing"), "dashboard"],
    ["/whatsapp-connect", t("nav.whatsapp"), "whatsapp"],
    ["/templates", t("nav.templates"), "template"],
    ["/campaigns", t("nav.campaigns"), "campaign"],
    ["/automations", t("nav.automations"), "template"],
    ["/trust-center", t("nav.trustCenter"), "admin"],
    ["/core-health", t("nav.coreHealth"), "dashboard"],
  ] as const;

  const adminItems = profile.data?.is_super_admin
    ? ([
        ["/admin", t("nav.admin"), "admin"],
        ["/admin/site-content", t("nav.siteContent"), "template"],
      ] as const)
    : ([] as const);

  const permissions = profile.data?.permissions;
  const visibleMainItems = filterNavItems(mainItems, permissions);
  const visibleAdminItems = profile.data?.is_super_admin ? adminItems : ([] as typeof adminItems);
  const showCatalogShortcut = hasNavPermission(permissions, "contacts.view");

  return (
    <div className="app-shell">
      <button
        className="mobile-menu-button"
        onClick={() => setMobileOpen(true)}
        aria-label={t("shell.openMenu")}
      >
        <Icon name="menu" />
      </button>

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-lockup sidebar-brand">
            <BrandLogo tone="light" size="md" />
            <small>{branchSubtitle}</small>
          </div>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)}>
            <Icon name="close" />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-main">
            {visibleMainItems.map(([to, label, icon]) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                <Icon name={icon} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
          {visibleAdminItems.length > 0 && (
            <div className="sidebar-nav-admin">
              {visibleAdminItems.map(([to, label, icon]) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-action" onClick={() => themeStore.getState().toggleTheme()}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
            <span>{theme === "dark" ? t("shell.lightMode") : t("shell.darkMode")}</span>
          </button>
          <LanguageSwitcher />
          <button className="sidebar-action danger" onClick={() => authStore.getState().logout()}>
            <span>↪</span>
            <span>{t("logout")}</span>
          </button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      <section className={`app-content${isInboxRoute ? " app-content--inbox" : ""}`}>
        <header className="topbar">
          <div className="topbar-search">
            <Icon name="search" />
            <input placeholder={t("shell.searchPlaceholder")} />
          </div>
          <div className="topbar-actions">
            {showCatalogShortcut && (
              <Link to="/catalog" className="topbar-catalog-btn">🛒 {t("shell.catalogShortcut")}</Link>
            )}
            <NotificationMenu />
            <div className="user-chip">
              <div className="avatar">{initials}</div>
              <div className="user-copy">
                <strong>{displayName}</strong>
                <small>{roleSubtitle}</small>
              </div>
            </div>
          </div>
        </header>
        <RequirePermission>
          <Outlet />
        </RequirePermission>
      </section>
    </div>
  );
}
