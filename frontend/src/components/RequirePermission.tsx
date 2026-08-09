import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { canAccessRoute, DASHBOARD_PATH } from "../lib/navPermissions";

type CurrentUser = { permissions?: string[] };

export default function RequirePermission({ children }: { children: ReactNode }) {
  const location = useLocation();
  const profile = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<CurrentUser>("/auth/me")).data
  });

  if (profile.isLoading) {
    return <div className="page-loading">جاري التحميل…</div>;
  }

  if (!canAccessRoute(location.pathname, profile.data?.permissions)) {
    return <Navigate to={DASHBOARD_PATH} replace state={{ from: location.pathname }} />;
  }

  return children;
}
