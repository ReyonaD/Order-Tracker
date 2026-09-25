import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

// Who printed what, when — every confirmed print and reprint of an order's sheets,
// as reported by the floor (DTF Monitor). Opens as a popover from the Machine column.
interface Sheet { part: number; total: number; status: string; machine: string | null; operator: string | null; printedAt: string | null; reprints: number; lastReprintAt: string | null; lastReprintMachine: string | null; lastReprintOperator: string | null }
interface Ev { id: string; part: number; kind: string; machine: string | null; operator: string | null; fileName: string | null; at: string }

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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

  return (
    <span className="ph-wrap" ref={ref}>
      <button type="button" className={`ph-btn ${hasReprint ? "ph-has-reprint" : ""}`} title="Print history — who printed this order, and any reprints"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>⟳</button>
      {open && (
        <div className="ph-pop" onClick={(e) => e.stopPropagation()}>
          <div className="ph-head"><b>{orderName}</b> · print history</div>
          {err && <div className="ph-empty">{err}</div>}
          {!data && !err && <div className="ph-empty">Loading…</div>}
          {data && data.events.length === 0 && (
            <div className="ph-empty">No prints confirmed by the floor yet{data.sheets.length ? ` (${data.sheets.map((s) => `#${s.part} ${s.status.toLowerCase()}`).join(", ")})` : ""}.</div>
          )}
          {data && data.events.length > 0 && (
            <table className="ph-table">
              <thead><tr><th>When</th><th>What</th><th>Sheet</th><th>Machine</th><th>Operator</th></tr></thead>
              <tbody>
                {data.events.map((ev) => (
                  <tr key={ev.id} className={ev.kind === "reprint" ? "ph-reprint" : ""}>
                    <td>{when(ev.at)}</td>
                    <td><span className={`ph-kind ${ev.kind}`}>{ev.kind === "reprint" ? "REPRINT" : "print"}</span></td>
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
