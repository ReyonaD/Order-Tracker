import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// Chase list: orders due today (or overdue) that have not fully gone through the
// oven yet, with the stage each one is stuck in. Expected (orders) vs actual
// (sheets reported by DTF Monitor). Empty list = the day is clean.

type Stage = "not_started" | "downloaded" | "ripped" | "partial";
type Flag = "ok" | "warn" | "late";

interface ChaseSheet {
  part: number; total: number; copies: number; status: string;
  machine: string | null; operator: string | null;
  downloadedAt: string | null; rippedAt: string | null; printedAt: string | null; printedCount: number;
}
interface ChaseItem {
  id: string; orderName: string; storeCode: string; deadlineAt: string; isPickup: boolean;
  shipping: string; urgent: boolean; itemTypes: string[]; printStatus: string | null;
  stage: Stage; flag: Flag; since: string | null; sinceMin: number; dueInMin: number;
  message: string; who: string;
  progress: { printed: number; ripped: number; downloaded: number; total: number };
  sheets: ChaseSheet[];
}
interface ChaseSettings {
  lookbackDays: number; notStartedWarnMin: number;
  downloaded: [number, number]; ripped: [number, number]; partial: [number, number];
}
interface ChaseResponse {
  status: string; now: string; items: ChaseItem[];
  counts: { late: number; warn: number; ok: number; total: number };
  settings: ChaseSettings;
}

const STAGE_LABEL: Record<Stage, string> = {
  not_started: "Not started", downloaded: "Downloaded", ripped: "RIP'd", partial: "Partly printed",
};

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });

export default function ChasePanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["chase"],
    queryFn: () => api.get<ChaseResponse>("/chase"),
    refetchInterval: 30_000,
  });
  const data = q.data;
  const items = data?.items ?? [];
  const counts = data?.counts ?? { late: 0, warn: 0, ok: 0, total: 0 };
  const [settingsOpen, setSettingsOpen] = useState(false);

  // "Mark printed" reuses the normal order edit (same role permissions as the table).
  const markPrinted = useMutation({
    mutationFn: (id: string) => api.patch(`/orders/${id}`, { printStatus: "Printed" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["chase"] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
    onError: (e) => alert(e instanceof Error ? e.message : "Not allowed"),
  });

  const scope = data ? (data.settings.lookbackDays === 0 ? "today" : `today + last ${data.settings.lookbackDays} day${data.settings.lookbackDays > 1 ? "s" : ""}`) : "";

  return (
    <div className="panel chase">
      <div className="panel-header chase-head">
        <div>
          <h2>Chase list</h2>
          <div className="chase-sub">Orders due {scope || "today"} that are not through the oven yet, and the stage each one is stuck in. Refreshes every 30 s.</div>
        </div>
        <div className="chase-counts">
          <span className="chase-pill late">🔴 Late <b>{counts.late}</b></span>
          <span className="chase-pill warn">🟠 Watch <b>{counts.warn}</b></span>
          <span className="chase-pill ok">🟢 On track <b>{counts.ok}</b></span>
          <button className="link-btn" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh"}</button>
          <button className="link-btn" onClick={() => setSettingsOpen(true)} title="Chase list settings">⚙ Settings</button>
        </div>
      </div>

      {q.isError && <div className="banner error">{(q.error as Error)?.message || "Failed to load"}</div>}

      {data && items.length === 0 ? (
        <div className="chase-clean">✓ Day is clean — every order due {scope} has gone through the oven.</div>
      ) : (
        <div className="table-wrap">
          <table className="chase-table">
            <thead>
              <tr>
                <th>Order</th><th>Store</th><th>Due</th><th>Ship</th><th>Stage</th><th>What's happening</th><th>Sheets</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={`chase-row ${it.flag}`}>
                  <td className="chase-order">{it.orderName}{it.urgent && <span className="chase-urgent" title="Urgent">!</span>}</td>
                  <td>{it.storeCode}</td>
                  <td className="chase-due" title={new Date(it.deadlineAt).toLocaleString()}>{fmtDue(it.deadlineAt)}</td>
                  <td className="chase-ship">{it.isPickup ? "Pick-up" : it.shipping || "—"}</td>
                  <td><span className={`chase-stage ${it.stage}`}>{STAGE_LABEL[it.stage]}</span></td>
                  <td className="chase-msg">{it.message}</td>
                  <td className="chase-sheets">
                    {it.progress.total === 0 ? "—" : it.sheets.map((s) => (
                      <span key={s.part} className={`chase-sheet ${s.status.toLowerCase()}`}
                        title={`#${s.part}/${s.total} ${s.status.toLowerCase()}${s.machine ? ` · ${s.machine}` : ""}${s.operator ? ` · ${s.operator}` : ""}`}>
                        {s.status === "PRINTED" ? "✓" : s.status === "RIPPED" ? "◐" : "○"}{s.part}
                      </span>
                    ))}
                  </td>
                  <td className="chase-actions">
                    <button
                      className="chase-mark"
                      title="It was printed but never recorded — mark it Printed and drop it from this list"
                      disabled={markPrinted.isPending}
                      onClick={() => { if (confirm(`Mark ${it.orderName} as Printed?`)) markPrinted.mutate(it.id); }}
                    >✓ Mark printed</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {settingsOpen && data && (
        <SettingsModal
          initial={data.settings}
          isAdmin={isAdmin}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { setSettingsOpen(false); qc.invalidateQueries({ queryKey: ["chase"] }); }}
        />
      )}
    </div>
  );
}

function SettingsModal({ initial, isAdmin, onClose, onSaved }: {
  initial: ChaseSettings; isAdmin: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [s, setS] = useState<ChaseSettings>(initial);
  useEffect(() => setS(initial), [initial]);
  const save = useMutation({
    mutationFn: () => api.put("/chase/settings", s),
    onSuccess: onSaved,
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });
  const num = (v: string) => Math.max(0, parseInt(v || "0", 10) || 0);
  const pair = (key: "downloaded" | "ripped" | "partial", label: string, hint: string) => (
    <div className="chase-set-row">
      <div><b>{label}</b><small>{hint}</small></div>
      <label>amber after <input type="number" min={0} value={s[key][0]} onChange={(e) => setS({ ...s, [key]: [num(e.target.value), s[key][1]] })} /> min</label>
      <label>red after <input type="number" min={0} value={s[key][1]} onChange={(e) => setS({ ...s, [key]: [s[key][0], num(e.target.value)] })} /> min</label>
    </div>
  );
  return (
    <div className="chase-modal-bg" onClick={onClose}>
      <div className="chase-modal" onClick={(e) => e.stopPropagation()}>
        <div className="chase-modal-h"><b>⚙ Chase list settings</b><button className="link-btn" onClick={onClose}>✕</button></div>
        <div className="chase-set-row">
          <div><b>Scope</b><small>Which deadlines to include. 0 = today only; 1 = today + yesterday, …</small></div>
          <label>today + last <input type="number" min={0} max={14} value={s.lookbackDays} onChange={(e) => setS({ ...s, lookbackDays: Math.min(14, num(e.target.value)) })} /> days</label>
        </div>
        <div className="chase-set-row">
          <div><b>Not started</b><small>Nothing downloaded yet — turn amber when the deadline is this close. Overdue is always red.</small></div>
          <label>amber when due within <input type="number" min={0} value={s.notStartedWarnMin} onChange={(e) => setS({ ...s, notStartedWarnMin: num(e.target.value) })} /> min</label>
        </div>
        {pair("downloaded", "Downloaded, not RIP'd", "Time since the file landed on a machine")}
        {pair("ripped", "RIP'd, not printed", "Time since Flexi logged it")}
        {pair("partial", "Partly printed", "Time since the last sheet came out of the oven")}
        <div className="chase-modal-f">
          {!isAdmin && <span className="chase-sub">Only admins can change these.</span>}
          <button className="link-btn" onClick={onClose}>Cancel</button>
          {isAdmin && <button className="chase-save" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button>}
        </div>
      </div>
    </div>
  );
}
