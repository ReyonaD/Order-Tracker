import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AdminUser, Role } from "../../types";

const ROLES: Role[] = ["ADMIN", "DESIGNER", "MACHINIST", "CUSTOMER_SERVICE", "VIEWER"];

export default function UsersAdmin() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: AdminUser[] }>("/users") });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("DESIGNER");
  const [canViewReports, setCanViewReports] = useState(false);
  const [canViewSheets, setCanViewSheets] = useState(false);
  const [error, setError] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () => api.post("/users", { email, name, password, role, canViewReports, canViewSheets }),
    onSuccess: () => {
      setEmail(""); setName(""); setPassword(""); setRole("DESIGNER"); setCanViewReports(false); setCanViewSheets(false); setError("");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; data: Record<string, unknown> }) => api.patch(`/users/${v.id}`, v.data),
    onSuccess: invalidate,
    onError: (e) => alert(e instanceof Error ? e.message : "Failed"),
  });

  const onSubmit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  const resetPassword = (u: AdminUser) => {
    const pw = prompt(`New password for ${u.name} (min 6 chars):`);
    if (pw && pw.length >= 6) patch.mutate({ id: u.id, data: { password: pw } });
    else if (pw) alert("Password must be at least 6 characters");
  };

  return (
    <div className="admin-section">
      <form className="admin-form" onSubmit={onSubmit}>
        <h3>Add user</h3>
        <div className="admin-form-row">
          <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Password (min 6)" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="inline-check" title="Grant access to the Reports tab">
            <input type="checkbox" checked={canViewReports} onChange={(e) => setCanViewReports(e.target.checked)} /> Reports
          </label>
          <label className="inline-check" title="Grant access to the Sheets tab">
            <input type="checkbox" checked={canViewSheets} onChange={(e) => setCanViewSheets(e.target.checked)} /> Sheets
          </label>
          <button type="submit" disabled={create.isPending}>Add</button>
        </div>
        {error && <div className="login-error">{error}</div>}
      </form>

      <table className="admin-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Reports</th><th>Sheets</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {(data?.users ?? []).map((u) => (
            <tr key={u.id} className={u.active ? "" : "row-inactive"}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} onChange={(e) => patch.mutate({ id: u.id, data: { role: e.target.value } })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>
                <input type="checkbox" checked={u.active} onChange={(e) => patch.mutate({ id: u.id, data: { active: e.target.checked } })} />
              </td>
              <td>
                <input type="checkbox" checked={u.canViewReports} title="Reports tab access"
                  onChange={(e) => patch.mutate({ id: u.id, data: { canViewReports: e.target.checked } })} />
              </td>
              <td>
                <input type="checkbox" checked={u.canViewSheets} title="Sheets tab access"
                  onChange={(e) => patch.mutate({ id: u.id, data: { canViewSheets: e.target.checked } })} />
              </td>
              <td>
                <button className="link-btn" onClick={() => resetPassword(u)}>Reset password</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
