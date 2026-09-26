import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

// Floor queue: DTF Monitor's per-machine board (Downloaded → RIP'd → Printed ✓), proxied
// through OT so anyone signed in here can watch the floor without a second login.
interface Item {
  id: number; machine: string; operator: string; name: string; code: string; part: number; total: number;
  copies: number; inch: string; cust: string; assigned_at: string; ripped_at: string | null; printed_at: string | null;
  printed_count: number; manual: boolean; printed_machine: string; printed_operator: string; urgent: boolean; reprint?: boolean;
}
interface Meta { online: boolean; last_seen: string | null; operator: string; version: string }
interface Resp { status: string; machines: Record<string, Item[]>; meta?: Record<string, Meta>; now: string }

const STUCK = { dl: [30, 60], rip: [45, 90] }; // minutes → amber, red (same as the agent)
const mins = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const ago = (iso: string | null) => { const m = mins(iso); if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.floor(m / 60), r = m % 60; return `${h} h${r ? ` ${r} min` : ""} ago`; };
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
const stage = (it: Item) => (it.printed_at ? "done" : it.ripped_at ? "rip" : "dl");

function Row({ it }: { it: Item }) {
  const st = stage(it), copies = it.copies || 1, n = it.printed_count || 0;
  let msg = "", flag = "";
  if (st === "dl") { const m = mins(it.assigned_at); flag = m >= STUCK.dl[1] ? "late" : m >= STUCK.dl[0] ? "warn" : ""; msg = `Downloaded ${ago(it.assigned_at)} · ${flag ? "not RIP'd yet" : "waiting for RIP"}`; }
  else if (st === "rip") { const m = mins(it.ripped_at); flag = m >= STUCK.rip[1] ? "late" : m >= STUCK.rip[0] ? "warn" : ""; msg = `RIP'd ${ago(it.ripped_at)} · ${flag ? "not printed" : "waiting for oven"}${copies > 1 ? ` · ${n} of ${copies} printed` : ""}`; }
  else msg = `Printed ${clock(it.printed_at!)} · ${it.printed_machine || it.machine} · ${it.printed_operator || it.operator || ""}${copies > 1 ? ` · ${copies} of ${copies}` : ""}${it.manual ? " · marked" : ""}`;
  return (
    <div className={`fq-row ${st} ${flag}`} title={it.name}>
      <span className="fq-ic">{st === "done" ? "✓" : st === "rip" ? "◐" : "○"}</span>
      <div className="fq-main">
        <div className="fq-line1">
          <span className="fq-code">{it.code || it.name}{it.total > 1 && <small>{it.part}/{it.total}</small>}</span>
          {it.urgent && <em className="fq-urg">URGENT</em>}
          {it.reprint && <em className="fq-urg fq-rep">REPRINT</em>}
          <span className="fq-cust">{it.cust || it.name}</span>
          {it.inch && <b className="fq-inch">{it.inch}{copies > 1 ? ` ×${copies}` : ""}</b>}
          <span className={`fq-chip ${st}`}>{st === "done" ? "Printed" : st === "rip" ? "RIP'd" : "Downloaded"}</span>
        </div>
        <div className="fq-msg">{msg}</div>
      </div>
    </div>
  );
}

function MachineCard({ name, items, mm }: { name: string; items: Item[]; mm?: Meta }) {
  const [showDone, setShowDone] = useState(false);
  const online = !mm || mm.online;
  const open = items.filter((i) => !i.printed_at);
  const done = items.filter((i) => i.printed_at).sort((a, b) => (b.printed_at || "").localeCompare(a.printed_at || ""));
  const op = [...new Set(items.map((i) => i.operator).filter(Boolean))].join(", ") || mm?.operator || "";
  const nDl = open.filter((i) => !i.ripped_at).length, nRip = open.length - nDl;
  const inches = (arr: Item[]) => arr.reduce((a, i) => a + (parseFloat(String(i.inch || "").replace(/[^0-9.]/g, "")) || 0) * (i.copies || 1), 0);
  return (
    <section className={`fq-machine ${online ? "" : "fq-offline"}`}>
      <div className="fq-mh">
        <span className={`fq-dot ${online ? "on" : "off"}`} title={online ? "online" : `offline${mm?.last_seen ? ` · last seen ${ago(mm.last_seen)}` : ""}`} />
        <span className="fq-name">{name}</span>
        <span className="fq-op">{op}{!online && <b className="fq-offlbl"> · offline</b>}</span>
        <span className="fq-cnt"><i title="Downloaded">○ {nDl}</i><i title="RIP'd">◐ {nRip}</i><i title="Printed today">✓ {done.length}</i></span>
      </div>
      <div className="fq-body">
        {open.length ? (
          <>
            <div className="fq-sec">In progress · {open.length}{inches(open) > 0 && <span className="fq-tot">{Math.round(inches(open)).toLocaleString()}"</span>}</div>
            {open.map((it) => <Row key={it.id} it={it} />)}
          </>
        ) : <div className="fq-sec fq-idle">Nothing in progress</div>}
        {done.length > 0 && (
          <button type="button" className="fq-sec fq-toggle" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "▾" : "▸"} Printed today · {done.length}{inches(done) > 0 && <span className="fq-tot">{Math.round(inches(done)).toLocaleString()}"</span>}
          </button>
        )}
        {showDone && done.map((it) => <Row key={it.id} it={it} />)}
      </div>
    </section>
  );
}

export default function FloorQueuePanel() {
  const q = useQuery({ queryKey: ["floor-queue"], queryFn: () => api.get<Resp>("/chase/floor"), refetchInterval: 5000 });
  const machines = q.data?.machines || {};
  const meta = q.data?.meta || {};
  const names = Object.keys(machines).sort();
  let dl = 0, rip = 0, ok = 0, bad = 0;
  for (const m of names) for (const it of machines[m]) {
    const st = stage(it);
    if (st === "done") ok++; else if (st === "rip") { rip++; if (mins(it.ripped_at) >= STUCK.rip[0]) bad++; } else { dl++; if (mins(it.assigned_at) >= STUCK.dl[0]) bad++; }
  }
  return (
    <div className="panel floor">
      <div className="panel-header chase-head">
        <div>
          <h2>Floor queue</h2>
          <div className="chase-sub">Every printer's work list from DTF Monitor — Downloaded → RIP'd → Printed (oven camera). Refreshes every 5 s.</div>
        </div>
        <div className="chase-counts">
          <span className="chase-pill">○ Downloaded <b>{dl}</b></span>
          <span className="chase-pill">◐ RIP'd <b>{rip}</b></span>
          <span className="chase-pill ok">✓ Printed today <b>{ok}</b></span>
          {bad > 0 && <span className="chase-pill late">Needs attention <b>{bad}</b></span>}
          <a className="link-btn" href="https://dtfproductionstatus.com/queue" target="_blank" rel="noreferrer">Open on DTF Monitor ↗</a>
        </div>
      </div>
      {q.isError && <div className="banner error">{(q.error as Error)?.message || "Failed to load"}</div>}
      {q.data && names.length === 0 && <div className="chase-clean">✓ Day is clean — nothing in any printer's queue.</div>}
      <div className="fq-grid">
        {names.map((m) => <MachineCard key={m} name={m} items={machines[m]} mm={meta[m]} />)}
      </div>
    </div>
  );
}
