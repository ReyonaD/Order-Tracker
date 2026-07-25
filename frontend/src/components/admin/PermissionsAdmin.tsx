import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { PermissionsMatrix } from "../../types";
import { COLUMN_META, PERMISSION_COLUMNS } from "../../columns";

const ROLES = ["DESIGNER", "MACHINIST", "CUSTOMER_SERVICE", "VIEWER"] as const;
const EDITABLE = new Set(COLUMN_META.filter((c) => c.editable).map((c) => c.key));
const LABEL: Record<string, string> = Object.fromEntries(COLUMN_META.map((c) => [c.key, c.label]));

export default function PermissionsAdmin() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.get<{ permissions: PermissionsMatrix }>("/config/permissions"),
  });

  const [matrix, setMatrix] = useState<PermissionsMatrix | null>(null);
  useEffect(() => {
    if (data?.permissions) setMatrix(structuredClone(data.permissions));
  }, [data]);

  const save = useMutation({
    mutationFn: (m: PermissionsMatrix) => api.put("/config/permissions", { permissions: m }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permissions"] });
      alert("Permissions saved.");
    },
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });

  if (!matrix) return <div className="admin-section muted">Loading…</div>;

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

  return (
    <div className="admin-section">
      <p className="muted">
        Configure what each role can <b>see</b> and <b>edit</b>, per column. Admins always
        have full access. Turning off “View” also turns off “Edit”. Only editable columns
        (designer/operator/print/etc.) can be edited.
      </p>
      <table className="admin-table perm-table">
        <thead>
          <tr>
            <th>Column</th>
            {ROLES.map((r) => <th key={r} colSpan={2} className="perm-role">{r}</th>)}
          </tr>
          <tr>
            <th></th>
            {ROLES.map((r) => (
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
              {ROLES.map((role) => {
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
