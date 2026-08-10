import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { hasNavPermission, type NavPermissionRule } from "../lib/navPermissions";

export type CurrentUserProfile = {
  full_name: string;
  email: string;
  is_super_admin: boolean;
  role?: string;
  permissions?: string[];
  branch_name?: string | null;
  account_name?: string | null;
  organizations?: Array<{ id: string; name: string }>;
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<CurrentUserProfile>("/auth/me")).data
  });
}

export function useHasPermission(rule: NavPermissionRule): boolean {
  const { data } = useCurrentUser();
  return hasNavPermission(data?.permissions, rule);
}
