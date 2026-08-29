import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { PermissionsMatrix } from "../../types";
import { COLUMN_META, PERMISSION_COLUMNS } from "../../columns";

// Built-in roles can't be deleted (mirrors the backend BUILTIN_ROLES).
const BUILTIN = new Set(["DESIGNER", "MACHINIST", "CUSTOMER_SERVICE", "VIEWER"]);
const EDITABLE = new Set(COLUMN_META.filter((c) => c.editable).map((c) => c.key));
const LABEL: Record<string, string> = Object.fromEntries(COLUMN_META.map((c) => [c.key, c.label]));

export default function PermissionsAdmin() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.get<{ permissions: PermissionsMatrix }>("/config/permissions"),
  });

  const [matrix, setMatrix] = useState<PermissionsMatrix | null>(null);
  const [newRole, setNewRole] = useState("");
  useEffect(() => {
    if (data?.permissions) setMatrix(structuredClone(data.permissions));
  }, [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["permissions"] });
    qc.invalidateQueries({ queryKey: ["roles"] });
  };

  const save = useMutation({
    mutationFn: (m: PermissionsMatrix) => api.put("/config/permissions", { permissions: m }),
    onSuccess: () => { invalidate(); alert("Permissions saved."); },
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });

  const addRole = useMutation({
    mutationFn: (name: string) => api.post("/config/roles", { name }),
    onSuccess: () => { setNewRole(""); invalidate(); },
    onError: (e) => alert(e instanceof Error ? e.message : "Failed to add role"),
  });

  const delRole = useMutation({
    mutationFn: (name: string) => api.del(`/config/roles/${encodeURIComponent(name)}`),
    onSuccess: invalidate,
    onError: (e) => alert(e instanceof Error ? e.message : "Failed to delete role"),
  });

  if (!matrix) return <div className="admin-section muted">Loading…</div>;

  const roles = Object.keys(matrix);

  const setCell = (role: string, col: string, field: "view" | "edit", val: boolean) => {
    setMatrix((prev) => {
      const next = structuredClone(prev!);
      const cell = next[role][col] || { view: true, edit: false };
      cell[field] = val;
      if (field === "view" && !val) cell.edit = false; // edit requires view
      if (!EDITABLE.has(col)) cell.edit = false;
      next[role][col] = cell;
      return next;
    });
  };

  const removeRole = (name: string) => {
    if (confirm(`Delete role "${name}"? This can't be undone.`)) delRole.mutate(name);
  };

  return (
    <div className="admin-section">
      <p className="muted">
        Configure what each role can <b>see</b> and <b>edit</b>, per column. Admins always
        have full access. Turning off “View” also turns off “Edit”. Only editable columns
        (designer/operator/print/etc.) can be edited.
      </p>

      <div className="admin-form-row" style={{ marginBottom: 12 }}>
        <input
          placeholder="New role name (e.g. QUALITY_CHECK)"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newRole.trim()) addRole.mutate(newRole); }}
        />
        <button onClick={() => newRole.trim() && addRole.mutate(newRole)} disabled={addRole.isPending || !newRole.trim()}>
          + Add role
        </button>
      </div>

      <table className="admin-table perm-table">
        <thead>
          <tr>
            <th>Column</th>
            {roles.map((r) => (
              <th key={r} colSpan={2} className="perm-role">
                {r}
                {!BUILTIN.has(r) && (
                  <button className="link-btn danger" title="Delete this custom role"
                    style={{ marginLeft: 6 }} onClick={() => removeRole(r)} disabled={delRole.isPending}>✕</button>
                )}
              </th>
            ))}
          </tr>
          <tr>
            <th></th>
            {roles.map((r) => (
              <Fragment key={r}>
                <th className="perm-sub">View</th>
                <th className="perm-sub">Edit</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_COLUMNS.map((col) => (
            <tr key={col}>
              <td>{LABEL[col]}</td>
              {roles.map((role) => {
                const cell = matrix[role]?.[col] ?? { view: true, edit: false };
                return (
                  <Fragment key={role}>
                    <td className="center">
                      <input type="checkbox" checked={cell.view}
                        onChange={(e) => setCell(role, col, "view", e.target.checked)} />
                    </td>
                    <td className="center">
                      <input type="checkbox" checked={cell.edit} disabled={!EDITABLE.has(col) || !cell.view}
                        onChange={(e) => setCell(role, col, "edit", e.target.checked)} />
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14 }}>
        <button onClick={() => save.mutate(matrix)} disabled={save.isPending}>Save permissions</button>
      </div>
    </div>
  );
}
