import { useQuery } from "@tanstack/react-query";
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
interface ChaseResponse { status: string; now: string; items: ChaseItem[]; counts: { late: number; warn: number; ok: number; total: number } }

const STAGE_LABEL: Record<Stage, string> = {
  not_started: "Not started", downloaded: "Downloaded", ripped: "RIP'd", partial: "Partly printed",
};

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });

export default function ChasePanel() {
  const q = useQuery({
    queryKey: ["chase"],
    queryFn: () => api.get<ChaseResponse>("/chase"),
    refetchInterval: 30_000,
  });
  const data = q.data;
  const items = data?.items ?? [];
  const counts = data?.counts ?? { late: 0, warn: 0, ok: 0, total: 0 };

  return (
    <div className="panel chase">
      <div className="panel-header chase-head">
        <div>
          <h2>Chase list</h2>
          <div className="chase-sub">Due today and not through the oven yet — the stage each order is stuck in. Refreshes every 30 s.</div>
        </div>
        <div className="chase-counts">
          <span className="chase-pill late">🔴 Late <b>{counts.late}</b></span>
          <span className="chase-pill warn">🟠 Watch <b>{counts.warn}</b></span>
          <span className="chase-pill ok">🟢 On track <b>{counts.ok}</b></span>
          <button className="link-btn" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      {q.isError && <div className="banner error">{(q.error as Error)?.message || "Failed to load"}</div>}

      {data && items.length === 0 ? (
        <div className="chase-clean">✓ Day is clean — every order due today has gone through the oven.</div>
      ) : (
        <div className="table-wrap">
          <table className="chase-table">
            <thead>
              <tr>
                <th>Order</th><th>Store</th><th>Due</th><th>Ship</th><th>Stage</th><th>What's happening</th><th>Sheets</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
