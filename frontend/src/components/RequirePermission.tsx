import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "../hooks/usePermissions";
import { canAccessRoute, DASHBOARD_PATH } from "../lib/navPermissions";

export default function RequirePermission({ children }: { children: ReactNode }) {
  const location = useLocation();
  const profile = useCurrentUser();

  if (profile.isLoading) {
    return <div className="page-loading">جاري التحميل…</div>;
  }

  if (!canAccessRoute(location.pathname, profile.data?.permissions)) {
    return <Navigate to={DASHBOARD_PATH} replace state={{ from: location.pathname }} />;
  }

  return children;
}
