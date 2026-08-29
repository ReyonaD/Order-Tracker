import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api/client";
import { StaffResponse, StaffRow, StaffTotals, Store } from "../types";
import { DateRangePicker, StorePicker } from "./ReportsPanel";

// ---- date helpers (local calendar days) ----
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function firstOfMonth(): Date { const d = new Date(); d.setDate(1); return d; }

type Preset = "today" | "last7" | "last30" | "month" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

function inch(n: number): string { return Math.round(n).toLocaleString() + '"'; }
function num(n: number): string { return n.toLocaleString(); }

type SortCol = "name" | "files" | "units" | "inches";
const COLS: { key: SortCol; label: string; fmt: (r: StaffRow) => string; get: (r: StaffRow) => number | string }[] = [
  { key: "files", label: "Files", fmt: (r) => num(r.files), get: (r) => r.files },
  { key: "inches", label: "Total inches", fmt: (r) => inch(r.inches), get: (r) => r.inches },
  { key: "units", label: "Units", fmt: (r) => num(r.units), get: (r) => r.units },
];

function StaffTable({ label, rows, totals }: { label: string; rows: StaffRow[]; totals?: StaffTotals }) {
  const [sortCol, setSortCol] = useState<SortCol>("files");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => {
    const g = [...rows];
    g.sort((a, b) => {
      const av = sortCol === "name" ? a.name : (sortCol === "files" ? a.files : sortCol === "units" ? a.units : a.inches);
      const bv = sortCol === "name" ? b.name : (sortCol === "files" ? b.files : sortCol === "units" ? b.units : b.inches);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return dir === "asc" ? cmp : -cmp;
    });
    return g;
  }, [rows, sortCol, dir]);
  const barMax = sorted.reduce((mx, r) => Math.max(mx, r.files), 0) || 1;
  const onSort = (c: SortCol) => {
    if (sortCol === c) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(c); setDir(c === "name" ? "asc" : "desc"); }
  };
  const arrow = (c: SortCol) => (sortCol === c ? (dir === "asc" ? " ▲" : " ▼") : "");
  return (
    <table className="report-table">
      <thead>
        <tr>
          <th className="sortable" onClick={() => onSort("name")}>{label}{arrow("name")}</th>
          {COLS.map((c) => <th key={c.key} className="num sortable" onClick={() => onSort(c.key)}>{c.label}{arrow(c.key)}</th>)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.name}>
            <td><div className="rt-key">{r.name}</div><div className="rt-bar" style={{ width: `${(r.files / barMax) * 100}%` }} /></td>
            {COLS.map((c) => <td key={c.key} className="num">{c.fmt(r)}</td>)}
          </tr>
        ))}
        {sorted.length === 0 && <tr><td colSpan={COLS.length + 1} className="report-empty">No data in this range.</td></tr>}
      </tbody>
      {totals && (
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">{num(totals.files)}</td>
            <td className="num">{inch(totals.inches)}</td>
            <td className="num">{num(totals.units)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export default function StaffPanel() {
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(fmt(daysAgo(7)));
  const [customTo, setCustomTo] = useState(fmt(new Date()));
  const [stores, setStores] = useState<string[]>([]);

  const storesQuery = useQuery({
    queryKey: ["stores"],
    queryFn: () => api.get<{ stores: Store[] }>("/stores"),
    staleTime: 5 * 60 * 1000,
  });

  const { from, to } = useMemo(() => {
    switch (preset) {
      case "today": return { from: fmt(new Date()), to: fmt(new Date()) };
      case "last7": return { from: fmt(daysAgo(6)), to: fmt(new Date()) };
      case "last30": return { from: fmt(daysAgo(29)), to: fmt(new Date()) };
      case "month": return { from: fmt(firstOfMonth()), to: fmt(new Date()) };
      case "custom": return { from: customFrom, to: customTo };
    }
  }, [preset, customFrom, customTo]);

  const params = { from, to, store: stores.join(",") };
  const q = useQuery({
    queryKey: ["staff", params],
    queryFn: () => api.get<StaffResponse>(`/staff/summary${qs(params)}`),
  });

  const data = q.data;
  const storeLabel = stores.length === 0 ? "All stores" : stores.length <= 3 ? stores.join(", ") : `${stores.length} stores`;

  return (
    <div className="reports">
      <div className="report-controls no-print">
        <div className="rc-row">
          <label>Range
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          {preset === "custom" && (
            <label>Dates
              <DateRangePicker from={customFrom} to={customTo} onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }} />
            </label>
          )}
          <label>Stores
            <StorePicker stores={storesQuery.data?.stores ?? []} value={stores} onChange={setStores} />
          </label>
          <div className="spacer" />
          <button className="btn-primary" onClick={() => window.print()} disabled={!data}>⬇ Export PDF</button>
        </div>
      </div>

      <div className="report-print">
        <div className="report-head">
          <h1>{storeLabel} — Staff productivity</h1>
          <div className="report-sub">{from} → {to} · excl. cancelled</div>
        </div>

        {q.isError && <div className="banner error">{(q.error as Error)?.message || "Staff report failed"}</div>}
        {q.isLoading && <div className="report-empty">Loading…</div>}

        {data && (
          <>
            <div className="report-cards">
              <div className="report-card"><span className="rc-num">{num(data.designers.length)}</span><span className="rc-lbl">Designers</span></div>
              <div className="report-card"><span className="rc-num">{num(data.totals.designers.files)}</span><span className="rc-lbl">Files uploaded</span></div>
              <div className="report-card"><span className="rc-num">{num(data.operators.length)}</span><span className="rc-lbl">Operators</span></div>
              <div className="report-card"><span className="rc-num">{num(data.totals.operators.files)}</span><span className="rc-lbl">Files printed</span></div>
              <div className="report-card"><span className="rc-num">{inch(data.totals.operators.inches)}</span><span className="rc-lbl">Inches printed</span></div>
            </div>

            <div className="report-head" style={{ marginTop: 24 }}>
              <h1>Designers — files uploaded</h1>
              <div className="report-sub">Order files assigned to each designer in this range.</div>
            </div>
            <StaffTable label="Designer" rows={data.designers} totals={data.totals.designers} />

            <div className="report-head" style={{ marginTop: 32 }}>
              <h1>Operators — files printed</h1>
              <div className="report-sub">Files printed by each machine operator, with total print length.</div>
            </div>
            <StaffTable label="Operator" rows={data.operators} totals={data.totals.operators} />

            {data.machines.length > 0 && (
              <>
                <div className="report-head" style={{ marginTop: 32 }}>
                  <h1>By machine</h1>
                  <div className="report-sub">Files printed on each machine.</div>
                </div>
                <StaffTable label="Machine" rows={data.machines} />
              </>
            )}

            <p className="report-note">
              Grouped by order date (there is no separate upload/print timestamp). Total inches = sum of DTF/UV/Sublimation
              lengths × quantity. Cancelled orders are excluded.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
