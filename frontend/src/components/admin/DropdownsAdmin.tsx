import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DropdownCategory, DropdownOption } from "../../types";

const CATEGORIES: { key: DropdownCategory; label: string }[] = [
  { key: "designer", label: "Designers" },
  { key: "machinist", label: "Machinists" },
  { key: "machine", label: "Machines" },
  { key: "uploadStatus", label: "Upload status" },
  { key: "printStatus", label: "Print status" },
];

export default function DropdownsAdmin() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<DropdownCategory>("designer");
  const [value, setValue] = useState("");

  const { data } = useQuery({
    queryKey: ["dropdowns-all"],
    queryFn: () => api.get<{ options: DropdownOption[] }>("/dropdowns/all"),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dropdowns-all"] });
    qc.invalidateQueries({ queryKey: ["dropdowns"] });
  };

  const add = useMutation({
    mutationFn: () => api.post("/dropdowns", { category, value: value.trim(), sort: 0 }),
    onSuccess: () => { setValue(""); invalidate(); },
    onError: (e) => alert(e instanceof Error ? e.message : "Failed"),
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; data: Record<string, unknown> }) => api.patch(`/dropdowns/${v.id}`, v.data),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/dropdowns/${id}`),
    onSuccess: invalidate,
  });

  const options = (data?.options ?? []).filter((o) => o.category === category);

  return (
    <div className="admin-section">
      <div className="admin-subtabs">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={category === c.key ? "active" : ""} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="admin-form-row">
        <input
          placeholder={`New ${category} value`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) add.mutate(); }}
        />
        <button onClick={() => value.trim() && add.mutate()} disabled={add.isPending}>Add</button>
      </div>

      <table className="admin-table">
        <thead><tr><th>Value</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.id} className={o.active ? "" : "row-inactive"}>
              <td>{o.value}</td>
              <td>
                <input type="checkbox" checked={o.active}
                  onChange={(e) => patch.mutate({ id: o.id, data: { active: e.target.checked } })} />
              </td>
              <td>
                <button className="link-btn danger" onClick={() => { if (confirm(`Delete "${o.value}"?`)) del.mutate(o.id); }}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {options.length === 0 && <tr><td colSpan={3} className="muted">No values yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
