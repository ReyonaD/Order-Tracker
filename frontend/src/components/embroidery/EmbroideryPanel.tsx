import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, qs } from "../../api/client";
import "./embroidery.css";

// Embroidery: the EMB-EMBROIDERY ORDERS sheet as a page. ShipStation fills the orders
// (every Etsy shop), Dropbox the design links, the packing-slip barcode PRINTED.
// Customer service, order status, design status, logo/text and prepared by stay manual.

type Column = "customerService" | "orderStatus" | "designStatus" | "logoOrText" | "preparedBy" | "printStatus";
interface Option { id: string; column: Column; value: string; color: string; position: number }
interface Design { id: string; name: string; uploadedAt: string | null }
interface Item { name: string | null; sku: string | null; quantity: number; imageUrl: string | null; options: { name: string; value: string }[] }
interface EmbOrder {
  id: string; orderNumber: string; shopName: string | null; orderDate: string; shipByDate: string | null;
  ssStatus: string; shippedAt: string | null; customerName: string | null; products: string; items: Item[];
  customerService: string | null; orderStatus: string | null; designStatus: string | null; logoOrText: string | null;
  preparedBy: string | null; note: string | null; printStatus: string | null; printedAt: string | null; printedBy: string | null;
  designs: Design[];
}
interface SyncInfo { configured: boolean; last: { at: string; error: string | null } | null }
interface Meta {
  options: Option[]; shops: string[]; counts: { todo: number; nolabel: number };
  sync: { shipstation: SyncInfo; dropbox: SyncInfo };
}

const COLUMN_LABEL: Record<Column, string> = {
  customerService: "Customer service", orderStatus: "Order status", designStatus: "Design status",
  logoOrText: "Logo or text", preparedBy: "Prepared by", printStatus: "Print status",
};
// To do = label created and not printed (labels are bought in the morning, then the orders are embroidered)
const VIEWS = [
  { key: "todo", label: "To do", title: "Label created, not printed yet" },
  { key: "nodesign", label: "No design yet", title: "Not printed, no design file in Dropbox (READY DESIGN orders are left out)" },
  { key: "nolabel", label: "No label yet", title: "Not printed, no label created in ShipStation yet" },
  { key: "printed", label: "Printed", title: "Barcode scanned or marked PRINTED" },
  { key: "labelled", label: "Label created", title: "Every order with a ShipStation label" },
  { key: "cancelled", label: "Cancelled", title: "Cancelled in ShipStation or marked CANCELED" },
  { key: "all", label: "All", title: "Every embroidery order of the last weeks" },
];
const API_URL = import.meta.env.VITE_API_URL ?? "/api";
const designUrl = (id: string) => `${API_URL}/embroidery/design/${id}?token=${encodeURIComponent(getToken() || "")}`;

const ink = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#1f2328" : "#fff";
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) : "—");
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export default function EmbroideryPanel() {
  const [tab, setTab] = useState<"orders" | "scan">("orders");
  const [lists, setLists] = useState(false);
  const meta = useQuery({ queryKey: ["embMeta"], queryFn: () => api.get<Meta>("/embroidery/meta"), refetchInterval: 20_000 });
  return (
    <div className="emb-panel">
      <div className="emb-tabs">
        <button className={`emb-tab ${tab === "orders" ? "on" : ""}`} onClick={() => setTab("orders")}>Orders</button>
        <button className={`emb-tab ${tab === "scan" ? "on" : ""}`} onClick={() => setTab("scan")}>▥ Scan printed</button>
        <div className="emb-spacer" />
        {meta.data && <SyncBadge meta={meta.data} />}
        <button className="emb-btn" onClick={() => setLists(true)}>Edit lists</button>
      </div>
      {tab === "orders" ? <OrdersTab meta={meta.data} /> : <ScanTab />}
      {lists && meta.data && <ListsEditor options={meta.data.options} onClose={() => setLists(false)} />}
    </div>
  );
}

function SyncBadge({ meta }: { meta: Meta }) {
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api.post("/embroidery/sync"),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["embMeta"] }); qc.invalidateQueries({ queryKey: ["embOrders"] }); },
  });
  // both sync on their own on the server; "Sync now" only runs them at once
  const part = (name: string, s: SyncInfo, every: string) => {
    const at = s.last ? new Date(s.last.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    return !s.configured ? <span className="emb-sync off">{name}: not connected</span>
      : s.last?.error ? <span className="emb-sync err" title={s.last.error}>{name}: error at {at}</span>
        : <span className="emb-sync" title={`Syncs automatically every ${every}`}>{name}: {s.last ? `${at} (${ago(s.last.at)})` : "starting…"}</span>;
  };
  return (
    <div className="emb-syncs">
      <span className="emb-sync off">Auto-sync: ShipStation every 3 min, Dropbox every 1 min ·</span>
      {part("ShipStation", meta.sync.shipstation, "3 minutes")}
      {part("Dropbox", meta.sync.dropbox, "minute")}
      <button className="emb-btn" disabled={sync.isPending} onClick={() => sync.mutate()}>{sync.isPending ? "Syncing…" : "↻ Sync now"}</button>
    </div>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────
function OrdersTab({ meta }: { meta?: Meta }) {
  const qc = useQueryClient();
  const [view, setView] = useState("todo");
  const [shop, setShop] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const key = ["embOrders", view, shop, q, page];
  const orders = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ orders: EmbOrder[]; total: number; pageSize: number }>(`/embroidery/orders${qs({ view, shop, q, page })}`),
    refetchInterval: 30_000, placeholderData: keepPreviousData,
  });
  const patch = useMutation({
    mutationFn: (b: { id: string; field: Column | "note"; value: string | null }) =>
      api.patch<{ order: EmbOrder }>(`/embroidery/orders/${b.id}`, { field: b.field, value: b.value }),
    onSuccess: (r) => {
      qc.setQueryData(key, (d: { orders: EmbOrder[] } | undefined) => d && { ...d, orders: d.orders.map((o) => (o.id === r.order.id ? r.order : o)) });
      qc.invalidateQueries({ queryKey: ["embMeta"] });
    },
  });
  const addOption = useMutation({
    mutationFn: (b: { column: Column; value: string }) => api.post("/embroidery/options", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["embMeta"] }),
  });

  const opts = (c: Column) => (meta?.options ?? []).filter((o) => o.column === c);
  const set = (o: EmbOrder, field: Column, value: string | null) => patch.mutate({ id: o.id, field, value });
  const pick = (o: EmbOrder, c: Column) => (
    <PillSelect value={o[c]} options={opts(c)} onChange={(v) => set(o, c, v)}
      onAdd={async (v) => { await addOption.mutateAsync({ column: c, value: v }); set(o, c, v); }} />
  );
  const rows = orders.data?.orders ?? [];
  const total = orders.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (orders.data?.pageSize ?? 200)));

  return (
    <div className="emb-orders">
      <div className="emb-toolbar">
        <div className="emb-filters">
          {VIEWS.map((v) => (
            <button key={v.key} title={v.title} className={`emb-filter ${view === v.key ? "on" : ""}`} onClick={() => { setView(v.key); setPage(1); }}>
              {v.label}
              {(v.key === "todo" || v.key === "nolabel") && meta ? <span>{meta.counts[v.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="emb-actions">
          <select className="emb-input" value={shop} onChange={(e) => { setShop(e.target.value); setPage(1); }}>
            <option value="">All shops</option>
            {(meta?.shops ?? []).map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className="emb-input emb-search" placeholder="Order no, customer, product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="emb-table-wrap">
        <table className="emb-table">
          <thead>
            <tr>
              <th>Date</th><th>Order no</th><th>Shop name</th><th>Customer service</th><th>Order status</th><th>Product</th>
              <th>Design</th><th>Design status</th><th>Logo or text</th><th>Print status</th><th>Label created</th><th>Prepared by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const isOpen = open === o.id;
              const late = o.shipByDate && o.ssStatus === "awaiting_shipment" && new Date(o.shipByDate) < new Date();
              return [
                <tr key={o.id} className={`emb-row ${isOpen ? "open" : ""}`}>
                  <td className="emb-nowrap">{day(o.orderDate)}</td>
                  <td className="emb-nowrap">
                    <button className="emb-link emb-ono" onClick={() => setOpen(isOpen ? null : o.id)} title="Show items and personalization">
                      <span className="emb-caret">{isOpen ? "▾" : "▸"}</span>{o.orderNumber}
                    </button>
                    {o.note && <span className="emb-notedot" title={o.note}>●</span>}
                  </td>
                  <td><span className="emb-shop">{o.shopName ?? "—"}</span></td>
                  <td>{pick(o, "customerService")}</td>
                  <td>{pick(o, "orderStatus")}</td>
                  <td><span className="emb-product">{o.products}</span></td>
                  <td>
                    {o.designs.length ? o.designs.map((d) => (
                      <a key={d.id} className="emb-design" href={designUrl(d.id)} target="_blank" rel="noreferrer" title={d.name}>📎 {d.name}</a>
                    )) : <span className="emb-dim">—</span>}
                  </td>
                  <td>{pick(o, "designStatus")}</td>
                  <td>{pick(o, "logoOrText")}</td>
                  <td title={o.printStatus === "PRINTED" && o.printedBy ? `${o.printedBy} · ${stamp(o.printedAt)}` : undefined}>{pick(o, "printStatus")}</td>
                  <td className="emb-nowrap">
                    {o.ssStatus === "shipped" ? <span className="emb-tag yes" title={`Label created ${day(o.shippedAt)}`}>YES</span>
                      : o.ssStatus === "cancelled" ? <span className="emb-tag no">CANCELED</span>
                        : o.shipByDate ? <span className={`emb-shipby ${late ? "late" : ""}`}>by {day(o.shipByDate)}</span> : null}
                  </td>
                  <td>{pick(o, "preparedBy")}</td>
                </tr>,
                isOpen && (
                  <tr key={`${o.id}-d`} className="emb-detail-row">
                    <td colSpan={12}><OrderDetail o={o} onNote={(v) => patch.mutate({ id: o.id, field: "note", value: v })} /></td>
                  </tr>
                ),
              ];
            })}
            {!orders.isLoading && rows.length === 0 && (
              <tr><td colSpan={12} className="emb-empty">{q || shop ? "No order matches." : view === "todo" ? "Nothing to do 🎉" : "No orders here."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="emb-pager">
        <span>{total} orders{pages > 1 ? ` · page ${page}/${pages}` : ""}</span>
        {pages > 1 && <>
          <button className="emb-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="emb-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </>}
      </div>
    </div>
  );
}

function OrderDetail({ o, onNote }: { o: EmbOrder; onNote: (v: string | null) => void }) {
  const [note, setNote] = useState(o.note ?? "");
  return (
    <div className="emb-detail">
      <div className="emb-items">
        {o.items.map((it, i) => (
          <div key={i} className="emb-item">
            {it.imageUrl && <img src={it.imageUrl} alt="" loading="lazy" />}
            <div>
              <div className="emb-item-name">{it.quantity > 1 && <b>{it.quantity}× </b>}{it.name}</div>
              {it.sku && <div className="emb-dim">SKU {it.sku}</div>}
              <dl className="emb-opts">
                {it.options.map((p, j) => <div key={j}><dt>{p.name}</dt><dd>{p.value}</dd></div>)}
              </dl>
            </div>
          </div>
        ))}
      </div>
      <div className="emb-side">
        <div><span className="emb-dim">Customer</span> {o.customerName ?? "—"}</div>
        {o.printedBy && <div><span className="emb-dim">Printed</span> {o.printedBy} · {stamp(o.printedAt)}</div>}
        <label className="emb-dim" htmlFor={`note-${o.id}`}>Note</label>
        <textarea id={`note-${o.id}`} className="emb-note" value={note} rows={3} onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note.trim() !== (o.note ?? "")) onNote(note.trim() || null); }} />
      </div>
    </div>
  );
}

const ADD = "__add__";
function PillSelect({ value, options, onChange, onAdd }: {
  value: string | null; options: Option[]; onChange: (v: string | null) => void; onAdd: (v: string) => Promise<void>;
}) {
  const opt = options.find((o) => o.value === value);
  const style = opt ? { background: opt.color, color: ink(opt.color), borderColor: opt.color } : undefined;
  return (
    <select className={`emb-pill ${value ? "set" : ""}`} style={style} value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === ADD) {
          const nv = window.prompt("New choice")?.trim().toUpperCase();
          if (nv) onAdd(nv);
          return;
        }
        onChange(v || null);
      }}>
      <option value="" />
      {options.map((o) => <option key={o.id} value={o.value}>{o.value}</option>)}
      {value && !opt && <option value={value}>{value}</option>}
      <option value={ADD}>+ Add choice…</option>
    </select>
  );
}

// ── Scan ────────────────────────────────────────────────────────────────────
interface ScanResult { result: "printed" | "already" | "cancelled" | "unknown"; code: string; order?: EmbOrder; at: number }

let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = ok ? 880 : 220; o.type = ok ? "sine" : "square";
    g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.4));
  } catch { /* no sound */ }
}

function ScanTab() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [log, setLog] = useState<ScanResult[]>([]);
  const [err, setErr] = useState("");
  const scan = useMutation({
    mutationFn: (c: string) => api.post<Omit<ScanResult, "at">>("/embroidery/scan", { code: c }),
    onSuccess: (r) => {
      setErr("");
      beep(r.result === "printed");
      setLog((l) => [{ ...r, at: Date.now() }, ...l].slice(0, 30));
      qc.invalidateQueries({ queryKey: ["embOrders"] }); qc.invalidateQueries({ queryKey: ["embMeta"] });
    },
    onError: (e) => { beep(false); setErr((e as Error).message); },
  });
  // keep the cursor in the box so the scanner always types here
  useEffect(() => {
    const t = setInterval(() => { if (document.activeElement !== input.current && !document.querySelector(".emb-overlay")) input.current?.focus(); }, 1000);
    input.current?.focus();
    return () => clearInterval(t);
  }, []);
  const last = log[0];
  const MSG = {
    printed: ["ok", "Marked PRINTED"], already: ["warn", "Already printed"],
    cancelled: ["warn", "Marked PRINTED — but this order is CANCELLED in ShipStation"], unknown: ["err", "Not an embroidery order"],
  } as const;
  return (
    <div className="emb-scan">
      <form onSubmit={(e) => { e.preventDefault(); const c = code.trim(); if (c) scan.mutate(c); setCode(""); }}>
        <input ref={input} className="emb-scan-input" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="Scan the packing slip barcode…" autoComplete="off" />
      </form>
      {err && <div className="emb-flash err">{err}</div>}
      {last && (
        <div className={`emb-flash ${MSG[last.result][0]}`}>
          <b>{MSG[last.result][1]}</b> · {last.code}
          {last.order && <> · {last.order.shopName} · {last.order.products}
            {last.result === "already" && last.order.printedBy && <> · by {last.order.printedBy} {stamp(last.order.printedAt)}</>}</>}
        </div>
      )}
      {log.length > 0 && (
        <table className="emb-table emb-scanlog">
          <thead><tr><th>Time</th><th>Code</th><th>Result</th><th>Shop</th><th>Product</th></tr></thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.at}>
                <td>{new Date(r.at).toLocaleTimeString()}</td><td>{r.code}</td>
                <td><span className={`emb-res ${MSG[r.result][0]}`}>{MSG[r.result][1]}</span></td>
                <td>{r.order?.shopName ?? ""}</td><td>{r.order?.products ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Dropdown lists ──────────────────────────────────────────────────────────
function ListsEditor({ options, onClose }: { options: Option[]; onClose: () => void }) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["embMeta"] });
  const add = useMutation({ mutationFn: (b: { column: Column; value: string; color: string }) => api.post("/embroidery/options", b), onSuccess: done });
  const color = useMutation({ mutationFn: (b: { id: string; color: string }) => api.patch(`/embroidery/options/${b.id}`, { color: b.color }), onSuccess: done });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/embroidery/options/${id}`), onSuccess: done });
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <div className="emb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="emb-modal">
        <div className="emb-modal-h"><b>Dropdown choices</b><button className="emb-btn" onClick={onClose}>Close</button></div>
        <div className="emb-lists">
          {(Object.keys(COLUMN_LABEL) as Column[]).map((c) => (
            <div key={c} className="emb-list">
              <h4>{COLUMN_LABEL[c]}</h4>
              {options.filter((o) => o.column === c).map((o) => (
                <div key={o.id} className="emb-list-row">
                  <input type="color" value={o.color} onChange={(e) => color.mutate({ id: o.id, color: e.target.value })} />
                  <span className="emb-pill set" style={{ background: o.color, color: ink(o.color), borderColor: o.color }}>{o.value}</span>
                  <button className="emb-link danger" onClick={() => del.mutate(o.id)}>Remove</button>
                </div>
              ))}
              <form className="emb-list-row" onSubmit={(e) => {
                e.preventDefault();
                const v = (draft[c] ?? "").trim().toUpperCase();
                if (v) add.mutate({ column: c, value: v, color: "#e5e7eb" });
                setDraft({ ...draft, [c]: "" });
              }}>
                <input className="emb-input" placeholder="New choice" value={draft[c] ?? ""} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} />
                <button className="emb-btn">Add</button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
