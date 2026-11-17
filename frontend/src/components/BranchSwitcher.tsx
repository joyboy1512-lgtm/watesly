import { useEffect } from "react";
import { useCurrentUser } from "../hooks/usePermissions";
import { useSetWorkspaceOrganization, useWorkspaceOrganizationId } from "../hooks/useWorkspace";

export default function BranchSwitcher() {
  const profile = useCurrentUser();
  const selectedId = useWorkspaceOrganizationId();
  const setSelected = useSetWorkspaceOrganization();
  const orgs = profile.data?.organizations ?? [];

  useEffect(() => {
    if (!orgs.length) return;
    if (selectedId && orgs.some((item) => item.id === selectedId)) return;
    if (orgs.length === 1) setSelected(orgs[0].id);
  }, [orgs, selectedId, setSelected]);

  if (orgs.length <= 1) {
    const label = orgs[0]?.name || profile.data?.branch_name || "الفرع";
    return (
      <div className="branch-switcher branch-switcher-static" title={label}>
        <span className="branch-switcher-label">الفرع</span>
        <strong>{label}</strong>
      </div>
    );
  }

  return (
    <label className="branch-switcher">
      <span className="branch-switcher-label">الفرع</span>
      <select
        value={selectedId}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="تبديل الفرع"
      >
        <option value="">كل الفروع</option>
        {orgs.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
