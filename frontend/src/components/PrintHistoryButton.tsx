import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

// Who did what, when — every step the floor reported for an order's sheets
// (Downloaded → RIP'd → Printed, plus reprints), newest first. Opens as a popover
// from the Machine column. Times are always Texas time.
interface Sheet {
  part: number; total: number; status: string; machine: string | null; operator: string | null; fileName: string | null;
  downloadedAt: string | null; rippedAt: string | null; printedAt: string | null;
  reprints: number; lastReprintAt: string | null; lastReprintMachine: string | null; lastReprintOperator: string | null;
}
interface Ev { id: string; part: number; kind: string; machine: string | null; operator: string | null; fileName: string | null; at: string }

const TZ = "America/Chicago";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
/** "2:41 PM" for today (Texas), "Sep 26, 2:41 PM" for any other day. */
export const shortTexasTime = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  return dayKey(d) === dayKey(new Date()) ? time : `${d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })}, ${time}`;
};
export const fullTexasTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const KIND: Record<string, string> = { downloaded: "Downloaded", ripped: "RIP'd", print: "Printed", reprint: "REPRINT" };

// Steps reported before every stage was logged (only prints were) are rebuilt from the
// sheet's own timestamps, so older orders still show their Downloaded / RIP'd times.
function timeline(sheets: Sheet[], events: Ev[]): Ev[] {
  const out = [...events];
  const has = (part: number, kind: string) => events.some((e) => e.part === part && e.kind === kind);
  for (const s of sheets) {
    const add = (kind: string, at: string | null) => {
      if (at && !has(s.part, kind)) out.push({ id: `s-${s.part}-${kind}`, part: s.part, kind, machine: s.machine, operator: s.operator, fileName: s.fileName, at });
    };
    add("downloaded", s.downloadedAt);
    add("ripped", s.rippedAt);
    add("print", s.printedAt);
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export default function PrintHistoryButton({ orderId, orderName, hasReprint }: { orderId: string; orderName: string; hasReprint: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ sheets: Sheet[]; events: Ev[] } | null>(null);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    setData(null); setErr("");
    api.get<{ sheets: Sheet[]; events: Ev[] }>(`/orders/${orderId}/print-history`).then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Failed"));
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, orderId]);

  const rows = data ? timeline(data.sheets, data.events) : [];

  return (
    <span className="ph-wrap" ref={ref}>
      <button type="button" className={`ph-btn ${hasReprint ? "ph-has-reprint" : ""}`} title="Print history — every step (downloaded, RIP'd, printed, reprints) with time, machine and operator"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>⟳</button>
      {open && (
        <div className="ph-pop" onClick={(e) => e.stopPropagation()}>
          <div className="ph-head"><b>{orderName}</b> · print history <span className="ph-tz">Texas time</span></div>
          {err && <div className="ph-empty">{err}</div>}
          {!data && !err && <div className="ph-empty">Loading…</div>}
          {data && rows.length === 0 && <div className="ph-empty">Nothing reported by the floor for this order yet.</div>}
          {data && rows.length > 0 && (
            <table className="ph-table">
              <thead><tr><th>When</th><th>What</th><th>Sheet</th><th>Machine</th><th>Operator</th></tr></thead>
              <tbody>
                {rows.map((ev) => (
                  <tr key={ev.id} className={ev.kind === "reprint" ? "ph-reprint" : ""}>
                    <td title={fullTexasTime(ev.at)}>{shortTexasTime(ev.at)}</td>
                    <td><span className={`ph-kind ${ev.kind}`}>{KIND[ev.kind] || ev.kind}</span></td>
                    <td title={ev.fileName || ""}>#{ev.part}{(() => { const s = data.sheets.find((x) => x.part === ev.part); return s && s.total > 1 ? `/${s.total}` : ""; })()}</td>
                    <td>{ev.machine || "—"}</td>
                    <td>{ev.operator || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </span>
  );
}
