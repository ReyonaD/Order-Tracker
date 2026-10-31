import { CSSProperties, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "../../api/client";
import { Lang, loadLang, saveLang, STRINGS, Strings } from "./i18n";
import "./stock.css";

interface Warehouse { id: number; name: string; active: boolean; machines: { name: string; type: string }[] }
interface OverviewProduct { id: number; name: string; category: string; unit: string; minStock: number; levels: Record<number, number>; mins: Record<number, number>; total: number }
interface Overview {
  warehouses: Warehouse[]; products: OverviewProduct[]; usedToday: Record<number, number>;
  weekly: { days: string[]; rows: { warehouseId: number; day: string; type: string; n: number }[] };
  canManage: boolean; isAdmin: boolean; dtfConfigured: boolean; units: string[]; categories: string[];
}
interface InventoryItem { id: number; name: string; category: string; unit: string; minStock: number; quantity: number; status: string }
interface Movement {
  id: number; warehouse: string; product: string; unit: string; type: string; kind: string; quantity: number; before: number; after: number;
  note: string; actor: string; machine: string; source: string; reversedAt: string | null; createdAt: string;
}
interface Product { id: number; name: string; category: string; unit: string; minStock: number; active: boolean }

const ZONE = "America/Chicago";
const LOCALE: Record<Lang, string> = { en: "en-US", tr: "tr-TR", es: "es-ES" };
const texasDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: ZONE });
const when = (iso: string, lang: Lang) => new Date(iso).toLocaleString(LOCALE[lang], { timeZone: ZONE, dateStyle: "short", timeStyle: "short" });
const n2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
function newRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
function errText(e: unknown, t: Strings): string {
  if (e instanceof ApiError && e.code) {
    const f = t.err[e.code];
    if (typeof f === "function") return f(e.params || {});
    if (f) return f;
  }
  return e instanceof Error ? e.message : t.failed;
}
const unitOf = (t: Strings, u: string) => t.units[u] ?? u;
const statusOf = (q: number, min: number) => (q <= 0 ? "out" : q <= min ? "low" : "ok");

const ICONS: Record<string, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  drop: "M12 3s7 7.2 7 11.5A7 7 0 0 1 5 14.5C5 10.2 12 3 12 3z",
  warn: "M12 4l9 16H3zM12 10v4M12 17.5v.5",
  in: "M12 4v12M7 11l5 5 5-5M4 20h16",
  out: "M12 16V4M7 9l5-5 5 5M4 20h16",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  check: "M5 12.5l4.5 4.5L19 7",
  home: "M4 20V9l8-5 8 5v11M9 20v-6h6v6",
  swap: "M4 8h14l-4-4M20 16H6l4 4",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  chart: "M5 20V11M12 20V5M19 20v-7M3 20h18",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8h.01",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 6l2.2 1.5M17.6 16.5L19.8 18M2 12h3M19 12h3M4.2 18l2.2-1.5M17.6 7.5L19.8 6",
  download: "M12 4v11M7.5 11l4.5 4.5 4.5-4.5M4 20h16",
  spark: "M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  x: "M6 6l12 12M18 6L6 18",
  print: "M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z",
  refresh: "M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5",
  plus: "M12 5v14M5 12h14",
  chevron: "M9 6l6 6-6 6",
};
function Icon({ name }: { name: string }) {
  return <svg className="sk-i" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}
function ProductIcon({ name }: { name: string }) {
  // Inks show their own color; everything else keeps a symbol.
  const ink = /\bink\b/i.test(name);
  const tone = !ink ? "" : /cyan/i.test(name) ? "cyan" : /magenta/i.test(name) ? "pink" : /yellow/i.test(name) ? "yellow" : /black/i.test(name) ? "black" : /white/i.test(name) ? "white" : "";
  if (tone) return <span className={`sk-pi ${tone}`}><i className="sk-ink" /></span>;
  return <span className="sk-pi"><Icon name={/film/i.test(name) ? "layers" : /varnish|solution/i.test(name) ? "drop" : "box"} /></span>;
}
function Message({ text, ok }: { text: string; ok?: boolean }) {
  return text ? <div className={`sk-msg ${ok ? "ok" : "bad"}`} role="status">{text}</div> : null;
}
function StatusPill({ status, t }: { status: string; t: Strings }) {
  return <span className={`sk-pill ${status === "ok" ? "" : status}`}>{status === "out" ? t.stockOut : status === "low" ? t.stockLow : t.stockOk}</span>;
}
function Category({ value }: { value: string }) {
  return <span className={`sk-cat ${value === "DTF" ? "" : value === "UV" ? "uv" : "other"}`}>{value}</span>;
}
function PanelHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return <div className="sk-panel-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{children}</div>;
}
function WarehouseChips({ warehouses, selected, onSelect, t }: { warehouses: Warehouse[]; selected: number; onSelect: (id: number) => void; t: Strings }) {
  return (
    <div className="sk-chips">
      <button className={selected ? "" : "on"} onClick={() => onSelect(0)}>{t.allWarehouses}</button>
      {warehouses.map((w) => <button key={w.id} className={selected === w.id ? "on" : ""} onClick={() => onSelect(w.id)}>{w.name}</button>)}
    </div>
  );
}

// Grouped columns: one count axis, a legend, the peak of each series labelled, every
// day readable on hover/focus and as a plain table.
function WeeklyChart({ days, t, lang }: { days: { day: string; in: number; out: number }[]; t: Strings; lang: Lang }) {
  const [hover, setHover] = useState(-1);
  const top = Math.max(...days.flatMap((d) => [d.in, d.out]));
  const step = Math.max(1, Math.ceil(top / 3));
  const scale = step * 3;
  const peakOut = days.reduce((b, d, i) => (d.out > days[b].out ? i : b), 0);
  const peakIn = days.reduce((b, d, i) => (d.in > days[b].in ? i : b), 0);
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(LOCALE[lang], { weekday: "short", day: "numeric" });
  const series: ["out" | "in", string, string][] = [["out", "var(--sk-series-out)", t.use], ["in", "var(--sk-series-in)", t.receive]];
  return (
    <>
      <div className="sk-chart" role="img" aria-label={`${t.weekly}: ${days.map((d) => `${label(d.day)} ${t.use} ${d.out}, ${t.receive} ${d.in}`).join("; ")}`}>
        {[1, 2, 3].map((k) => <div key={k} className="sk-grid-line" style={{ bottom: `${(k / 3) * 100}%` }}><span>{k * step}</span></div>)}
        {days.map((d, i) => (
          <button key={d.day} type="button" className="sk-day" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} onFocus={() => setHover(i)} onBlur={() => setHover(-1)}>
            {series.map(([k, color]) => (
              <span key={k} className="sk-bar" style={{ height: `${(d[k] / scale) * 100}%`, background: color }}>
                {d[k] > 0 && i === (k === "out" ? peakOut : peakIn) && <em>{d[k]}</em>}
              </span>
            ))}
            {hover === i && (
              <span className="sk-tip">
                {label(d.day)}
                {series.map(([k, color, name]) => <div key={k}><b>{d[k]}</b><i style={{ background: color }} />{name}</div>)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="sk-labels">{days.map((d) => <span key={d.day}>{label(d.day)}</span>)}</div>
      <details className="sk-details">
        <summary>{t.asTable}</summary>
        <table className="sk-table">
          <thead><tr><th>{t.day}</th><th className="num">{t.use}</th><th className="num">{t.receive}</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.day}><td>{label(d.day)}</td><td className="num">{d.out}</td><td className="num">{d.in}</td></tr>)}</tbody>
        </table>
      </details>
    </>
  );
}

function OverviewTab({ data, selected, onSelect, goTo, onSync, syncing, t, lang }: {
  data: Overview; selected: number; onSelect: (id: number) => void; goTo: (tab: Tab) => void; onSync: () => void; syncing: boolean; t: Strings; lang: Lang;
}) {
  const active = data.warehouses.filter((w) => w.active);
  const scope = selected ? active.filter((w) => w.id === selected) : active;
  const scopeName = scope[0]?.name ?? "";
  const rows = data.products.flatMap((p) => scope.map((w) => {
    const quantity = p.levels[w.id] ?? 0;
    const min = p.mins[w.id] ?? p.minStock;
    return { p, w, quantity, min, status: statusOf(quantity, min) };
  }));
  const critical = rows.filter((r) => r.status !== "ok").sort((a, b) => a.quantity / (a.min || 1) - b.quantity / (b.min || 1));
  const healthy = rows.length - critical.length;
  const pct = rows.length ? Math.round((healthy / rows.length) * 100) : 0;
  const used = scope.reduce((n, w) => n + (data.usedToday[w.id] ?? 0), 0);
  const ids = new Set(scope.map((w) => w.id));
  const days = data.weekly.days.map((day) => {
    const m = data.weekly.rows.filter((r) => r.day === day && ids.has(r.warehouseId));
    return { day, in: m.filter((r) => r.type === "in").reduce((n, r) => n + r.n, 0), out: m.filter((r) => r.type === "out").reduce((n, r) => n + r.n, 0) };
  });
  const recent = useQuery({
    queryKey: ["stock-recent", selected],
    queryFn: () => api.get<{ rows: Movement[] }>(`/stock/history${qs({ warehouse: selected || undefined, page: 1 })}`),
    refetchInterval: 30000,
  });
  const last = (recent.data?.rows ?? []).slice(0, 5);
  return (
    <>
      <WarehouseChips warehouses={active} selected={selected} onSelect={onSelect} t={t} />
      {!data.dtfConfigured && <Message text={t.dtfOff} />}
      {!active.length && <Message text={t.noWarehouses} />}
      <section className="sk-hub">
        <div>
          <div className="sk-kicker"><Icon name="spark" /> {t.hubKicker}</div>
          <h2>{t.hubTitle}</h2>
          <p>{selected ? t.hubText(scopeName) : t.hubAll}</p>
        </div>
        <div className="sk-health">
          <div className="sk-ring" style={{ "--p": `${pct}%` } as CSSProperties}><strong>{pct}%</strong></div>
          <div><b>{t.health}</b>{t.healthOf(healthy, rows.length)}</div>
        </div>
      </section>
      <section className="sk-stats">
        <div className="sk-stat"><div className="sk-stat-top">{t.totalProducts}<span className="sk-stat-icon"><Icon name="box" /></span></div><div className="sk-stat-value">{data.products.length}</div><div className="sk-stat-foot"><Icon name="layers" /> {t.activeCatalog}</div></div>
        <div className={`sk-stat ${critical.length ? "amber" : ""}`}><div className="sk-stat-top">{t.critical}<span className="sk-stat-icon"><Icon name="warn" /></span></div><div className="sk-stat-value">{critical.length}</div><div className={`sk-stat-foot ${critical.length ? "warn" : ""}`}><Icon name={critical.length ? "chevron" : "check"} /> {critical.length ? t.restock : t.allGood}</div></div>
        <div className="sk-stat"><div className="sk-stat-top">{t.todayUse}<span className="sk-stat-icon"><Icon name="out" /></span></div><div className="sk-stat-value">{used}</div><div className="sk-stat-foot plain"><Icon name="clock" /> {t.usageRecords} · {new Date().toLocaleDateString(LOCALE[lang], { timeZone: ZONE })}</div></div>
        <div className="sk-stat"><div className="sk-stat-top">{t.activeWh}<span className="sk-stat-icon"><Icon name="home" /></span></div><div className="sk-stat-value">{active.length}</div><div className="sk-stat-foot"><Icon name="check" /> {t.perWarehouse}</div></div>
      </section>
      <section className="sk-grid">
        <div className="sk-panel">
          <PanelHead title={t.weekly} sub={t.last7}>
            <div className="sk-legend"><span><i style={{ background: "var(--sk-series-out)" }} />{t.use}</span><span><i style={{ background: "var(--sk-series-in)" }} />{t.receive}</span></div>
          </PanelHead>
          <div className="sk-panel-body">
            {days.some((d) => d.in || d.out) ? <WeeklyChart days={days} t={t} lang={lang} /> : <div className="sk-empty"><Icon name="chart" />{t.firstMove}</div>}
          </div>
        </div>
        <div className="sk-panel">
          <PanelHead title={t.priority} sub={t.priorityHint}>
            {critical.length > 4 && <a className="sk-link" href="#sk-inventory">{t.viewAll} <Icon name="chevron" /></a>}
          </PanelHead>
          <div className="sk-panel-body">
            {critical.length === 0 && <div className="sk-empty"><Icon name="check" />{t.allClear}</div>}
            {critical.slice(0, 4).map((r) => (
              <div key={`${r.p.id}-${r.w.id}`} className={`sk-alert ${r.status}`}>
                <ProductIcon name={r.p.name} />
                <div><strong>{r.p.name}</strong><small>{selected ? "" : `${r.w.name} · `}{t.minimum} {n2(r.min)} {unitOf(t, r.p.unit)}</small></div>
                <span>{n2(r.quantity)} {unitOf(t, r.p.unit)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      {active.length > 0 && (
        <section className="sk-panel" id="sk-inventory">
          <PanelHead title={t.inventory} sub={t.inventorySub} />
          <div className="sk-scroll">
            {selected ? (
              <table className="sk-table">
                <thead><tr><th>{t.product}</th><th>{t.category}</th><th>{t.quantity}</th><th className="num">{t.min}</th><th>{t.status}</th></tr></thead>
                <tbody>{rows.map(({ p, quantity, min, status }) => (
                  <tr key={p.id}>
                    <td><div className="sk-product"><ProductIcon name={p.name} />{p.name}</div></td>
                    <td><Category value={p.category} /></td>
                    <td><div className={`sk-meter ${status}`}><b>{n2(quantity)} <small>{unitOf(t, p.unit)}</small></b><div><i style={{ width: `${Math.min(100, (quantity / ((min || 1) * 2)) * 100)}%` }} /></div></div></td>
                    <td className="num">{n2(min)}</td>
                    <td><StatusPill status={status} t={t} /></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : (
              <table className="sk-table">
                <thead><tr><th>{t.product}</th><th>{t.category}</th><th className="num">{t.min}</th>
                  {data.warehouses.map((w) => <th key={w.id} className="num" title={w.active ? "" : t.removedWh}>{w.name}{w.active ? "" : " ⚠"}</th>)}
                  <th className="num">{t.total}</th></tr></thead>
                <tbody>{data.products.map((p) => (
                  <tr key={p.id}>
                    <td><div className="sk-product"><ProductIcon name={p.name} />{p.name}</div></td>
                    <td><Category value={p.category} /></td>
                    <td className="num">{n2(p.minStock)}</td>
                    {data.warehouses.map((w) => {
                      const q = p.levels[w.id] ?? 0;
                      const st = statusOf(q, p.mins[w.id] ?? p.minStock);
                      return <td key={w.id} className={`num ${st === "ok" ? "" : st}`}>{n2(q)}</td>;
                    })}
                    <td className="num"><b>{n2(p.total)}</b> <small>{unitOf(t, p.unit)}</small></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </section>
      )}
      <section className="sk-panel">
        <PanelHead title={t.recent} sub={t.recentSub}><button className="sk-link" onClick={() => goTo("history")}>{t.openHistory} <Icon name="chevron" /></button></PanelHead>
        {last.length === 0 ? <div className="sk-empty"><Icon name="clock" />{t.firstMove}</div> : (
          <div className="sk-scroll"><table className="sk-table">
            <thead><tr><th>{t.product}</th><th>{t.warehouse}</th><th>{t.type}</th><th className="num">{t.quantity}</th><th>{t.actor}</th><th>{t.date}</th></tr></thead>
            <tbody>{last.map((m) => (
              <tr key={m.id} className={m.reversedAt ? "sk-reversed" : ""}>
                <td><div className="sk-product"><ProductIcon name={m.product} />{m.product}</div></td><td>{m.warehouse}</td><td>{t.kinds[m.kind] ?? m.kind}</td>
                <td className="num">{m.type === "out" ? "−" : "+"}{n2(m.quantity)} {unitOf(t, m.unit)}</td>
                <td>{m.actor}{m.machine ? <small> · {m.machine}</small> : ""}</td><td>{when(m.createdAt, lang)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section className="sk-panel">
        <PanelHead title={t.warehouses}>
          {data.canManage && data.dtfConfigured && <button className="sk-btn small" disabled={syncing} onClick={onSync}><Icon name="refresh" /> {t.refresh}</button>}
        </PanelHead>
        <div className="sk-panel-body sk-wh">
          {data.warehouses.map((w) => (
            <div key={w.id}>
              <span className="sk-pi"><Icon name="home" /></span>
              <span><b>{w.name}</b><small>{!w.active ? t.removedWh : w.machines.length ? w.machines.map((m) => m.name).join(", ") : t.noMachines}</small></span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// Stock in / out: tap product cards into a list, one transaction for the whole list.
function MoveTab({ type, warehouses, categories, t, onDone }: { type: "in" | "out"; warehouses: Warehouse[]; categories: string[]; t: Strings; onDone: () => void }) {
  const [warehouseId, setWarehouseId] = useState(0);   // always asked first: a preselected one got stock booked to the wrong place
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [cat, setCat] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState({ text: "", ok: false });
  const requestId = useRef(newRequestId());   // kept until it succeeds, so a retry cannot apply twice
  const items = useQuery({
    queryKey: ["stock-inventory", warehouseId],
    queryFn: () => api.get<{ items: InventoryItem[] }>(`/stock/inventory${qs({ warehouse: warehouseId })}`),
    enabled: !!warehouseId,
  });
  const all = items.data?.items ?? [];
  const shown = all.filter((p) => (!cat || p.category === cat) && p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const ids = Object.keys(picked).map(Number);
  const save = useMutation({
    mutationFn: () => api.post<{ created: boolean }>("/stock/batch", {
      warehouseId, type, note, requestId: requestId.current,
      items: ids.map((id) => ({ productId: id, quantity: picked[id].replace(",", ".") })),
    }),
    onSuccess: (r) => {
      requestId.current = newRequestId();
      setPicked({}); setNote(""); setMsg({ text: r.created ? t.saved : t.already, ok: true });
      items.refetch(); onDone();
    },
    onError: (e) => setMsg({ text: errText(e, t), ok: false }),
  });
  const toggle = (p: InventoryItem) => setPicked((cur) => {
    const next = { ...cur };
    if (next[p.id]) delete next[p.id]; else next[p.id] = "1";
    return next;
  });
  const chooseWarehouse = (id: number) => { setWarehouseId(id); setPicked({}); setNote(""); setMsg({ text: "", ok: false }); requestId.current = newRequestId(); };
  if (!warehouseId) {
    return (
      <section className="sk-panel">
        <PanelHead title={t.pickWarehouse} sub={t.pickWarehouseSub} />
        <div className="sk-panel-body sk-whpick">
          {warehouses.map((w) => (
            <button key={w.id} onClick={() => chooseWarehouse(w.id)}>
              <span className="sk-pi"><Icon name="home" /></span>
              <span><b>{w.name}</b><small>{t.machines}: {w.machines.length}</small></span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
        {!warehouses.length && <div className="sk-empty">{t.noWarehouses}</div>}
      </section>
    );
  }
  return (
    <div className="sk-move">
      <div>
        <div className="sk-whnow">
          <span className="sk-pi"><Icon name="home" /></span>
          <div><small>{t.warehouse}</small><b>{warehouses.find((w) => w.id === warehouseId)?.name}</b></div>
          <button className="sk-btn small" onClick={() => chooseWarehouse(0)}>{t.change}</button>
        </div>
        <div className="sk-filter">
          <div className="sk-chips" style={{ alignSelf: "flex-end", paddingBottom: 6 }}>
            {[["", t.all], ...categories.map((c) => [c, c])].map(([k, l]) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>)}
          </div>
          <label className="sk-search" style={{ alignSelf: "flex-end" }}>
            <Icon name="search" />
            <input className="sk-input" aria-label={t.search} placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <div className="sk-cards">
          {shown.map((p) => (
            <button key={p.id} className={`sk-card ${picked[p.id] ? "on" : ""}`} disabled={type === "out" && p.quantity <= 0} onClick={() => toggle(p)}>
              <ProductIcon name={p.name} />
              <div>
                <b>{p.name}</b>
                <small>{n2(p.quantity)} {unitOf(t, p.unit)}</small>
                <StatusPill status={p.status} t={t} />
              </div>
            </button>
          ))}
        </div>
      </div>
      <aside className="sk-panel sk-side">
        <h2>{t.selected}</h2>
        {ids.length === 0 && <p className="sk-muted">{t.tapHint}</p>}
        {ids.map((id) => {
          const p = all.find((x) => x.id === id);
          return (
            <div key={id} className="sk-line">
              <span>{p?.name}</span>
              <input className="sk-input" value={picked[id]} inputMode="decimal" aria-label={t.quantity} onChange={(e) => setPicked({ ...picked, [id]: e.target.value })} />
              <small>{p ? unitOf(t, p.unit) : ""}</small>
              <button className="sk-x" title={t.remove} aria-label={t.remove} onClick={() => p && toggle(p)}><Icon name="x" /></button>
            </div>
          );
        })}
        <label className="sk-field">{t.note}<input className="sk-input" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="sk-btn primary block" disabled={!ids.length || save.isPending} onClick={() => save.mutate()}>
          <Icon name={type === "in" ? "in" : "out"} /> {type === "in" ? t.saveIn(ids.length) : t.saveOut(ids.length)}
        </button>
        <Message {...msg} />
      </aside>
    </div>
  );
}

function TransferTab({ warehouses, products, t, onDone }: { warehouses: Warehouse[]; products: OverviewProduct[]; t: Strings; onDone: () => void }) {
  const [f, setF] = useState({ sourceId: warehouses[0]?.id ?? 0, destinationId: warehouses[1]?.id ?? 0, productId: products[0]?.id ?? 0, quantity: "", note: "" });
  const [msg, setMsg] = useState({ text: "", ok: false });
  const save = useMutation({
    mutationFn: () => api.post("/stock/transfer", { ...f, quantity: f.quantity.replace(",", ".") }),
    onSuccess: () => { setF({ ...f, quantity: "", note: "" }); setMsg({ text: t.transferred, ok: true }); onDone(); },
    onError: (e) => setMsg({ text: errText(e, t), ok: false }),
  });
  const available = products.find((p) => p.id === f.productId)?.levels[f.sourceId] ?? 0;
  const select = (key: "sourceId" | "destinationId") => (
    <select className="sk-select" value={f[key]} onChange={(e) => setF({ ...f, [key]: Number(e.target.value) })}>
      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
  return (
    <section className="sk-panel sk-narrow">
      <PanelHead title={t.transfer} sub={t.subs.transfer} />
      <div className="sk-form">
        <label className="sk-field">{t.source}{select("sourceId")}</label>
        <label className="sk-field">{t.dest}{select("destinationId")}</label>
        <label className="sk-field">{t.product}
          <select className="sk-select" value={f.productId} onChange={(e) => setF({ ...f, productId: Number(e.target.value) })}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="sk-field">{t.quantity} ({n2(available)})<input className="sk-input" value={f.quantity} inputMode="decimal" onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
        <label className="sk-field full">{t.note}<input className="sk-input" value={f.note} maxLength={160} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className="full"><button className="sk-btn primary" disabled={!f.quantity || save.isPending} onClick={() => save.mutate()}><Icon name="swap" /> {t.transferDo}</button></div>
        {msg.text && <div className="full"><Message {...msg} /></div>}
      </div>
    </section>
  );
}

function AdjustTab({ warehouses, products, initial, t, onDone }: { warehouses: Warehouse[]; products: OverviewProduct[]; initial: number; t: Strings; onDone: () => void }) {
  const [f, setF] = useState({ warehouseId: initial || warehouses[0]?.id || 0, productId: products[0]?.id ?? 0, quantity: "", note: "" });
  const [msg, setMsg] = useState({ text: "", ok: false });
  const product = products.find((p) => p.id === f.productId);
  const current = product?.levels[f.warehouseId] ?? 0;
  const save = useMutation({
    mutationFn: () => api.post("/stock/adjust", f),
    onSuccess: () => { setF({ ...f, quantity: "", note: "" }); setMsg({ text: t.adjusted, ok: true }); onDone(); },
    onError: (e) => setMsg({ text: errText(e, t), ok: false }),
  });
  return (
    <section className="sk-panel sk-narrow">
      <PanelHead title={t.adjust} sub={t.adjustHint} />
      <div className="sk-form">
        <label className="sk-field">{t.warehouse}
          <select className="sk-select" value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: Number(e.target.value) })}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="sk-field">{t.product}
          <select className="sk-select" value={f.productId} onChange={(e) => setF({ ...f, productId: Number(e.target.value) })}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="sk-field">{t.inSystem}<input className="sk-input" disabled value={`${n2(current)} ${product ? unitOf(t, product.unit) : ""}`} /></label>
        <label className="sk-field">{t.actualCount}<input className="sk-input" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
        <label className="sk-field full">{t.reason}<input className="sk-input" maxLength={255} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className="full"><button className="sk-btn primary" disabled={!f.quantity.trim() || save.isPending} onClick={() => save.mutate()}><Icon name="check" /> {t.adjustDo}</button></div>
        {msg.text && <div className="full"><Message {...msg} /></div>}
      </div>
    </section>
  );
}

function HistoryTab({ warehouses, selected, onSelect, canManage, t, lang, onDone }: {
  warehouses: Warehouse[]; selected: number; onSelect: (id: number) => void; canManage: boolean; t: Strings; lang: Lang; onDone: () => void;
}) {
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["stock-history", selected, page],
    queryFn: () => api.get<{ rows: Movement[]; total: number; pageSize: number }>(`/stock/history${qs({ warehouse: selected || undefined, page })}`),
    refetchInterval: 30000,
  });
  const reverse = useMutation({
    mutationFn: (id: number) => api.post(`/stock/movements/${id}/reverse`),
    onSuccess: () => { setError(""); q.refetch(); onDone(); },
    onError: (e) => setError(errText(e, t)),
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <>
      <WarehouseChips warehouses={warehouses} selected={selected} onSelect={(id) => { onSelect(id); setPage(1); }} t={t} />
      <Message text={error} />
      <section className="sk-panel">
        <div className="sk-scroll">
          <table className="sk-table">
            <thead><tr><th>{t.date}</th><th>{t.warehouse}</th><th>{t.product}</th><th>{t.type}</th><th className="num">{t.quantity}</th><th className="num">{t.before}</th><th className="num">{t.after}</th><th>{t.actor}</th><th>{t.machine}</th><th>{t.noteCol}</th><th /></tr></thead>
            <tbody>
              {(q.data?.rows ?? []).map((m) => (
                <tr key={m.id} className={m.reversedAt ? "sk-reversed" : ""}>
                  <td>{when(m.createdAt, lang)}</td><td>{m.warehouse}</td><td>{m.product}</td><td>{t.kinds[m.kind] ?? m.kind}</td>
                  <td className="num">{m.type === "out" ? "−" : "+"}{n2(m.quantity)} {unitOf(t, m.unit)}</td>
                  <td className="num">{n2(m.before)}</td><td className="num">{n2(m.after)}</td><td>{m.actor}</td><td>{m.machine}</td><td>{m.note}</td>
                  <td>{canManage && (m.kind === "consumption" || m.kind === "stock") && !m.reversedAt && (
                    <button className="sk-btn small" disabled={reverse.isPending} onClick={() => { if (confirm(m.kind === "stock" ? t.reverseInAsk : t.reverseAsk)) reverse.mutate(m.id); }}>{t.reverse}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.data && q.data.rows.length === 0 && <div className="sk-empty"><Icon name="clock" />{t.noRows}</div>}
        <div className="sk-pager">
          <button className="sk-btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.prev}</button>
          <span>{t.page} {page} / {pages}</span>
          <button className="sk-btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.next}</button>
        </div>
      </section>
    </>
  );
}

function downloadCsv(rows: Movement[], t: Strings, lang: Lang) {
  // A cell starting with = + - @ would run as a formula in Excel.
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^\s*[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = [t.date, t.warehouse, t.product, t.quantity, t.unit, t.actor, t.machine, t.noteCol];
  const lines = rows.map((r) => [when(r.createdAt, lang), r.warehouse, r.product, r.quantity, unitOf(t, r.unit), r.actor, r.machine, r.note].map(cell).join(";"));
  const blob = new Blob(["﻿" + [head.map(cell).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stock-usage-${texasDay()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ReportTab({ warehouses, products, t, lang }: { warehouses: Warehouse[]; products: OverviewProduct[]; t: Strings; lang: Lang }) {
  const today = texasDay();
  const [draft, setDraft] = useState({ from: today.slice(0, 8) + "01", to: today, warehouse: "", product: "", actor: "", machine: "" });
  const [filters, setFilters] = useState(draft);
  const q = useQuery({
    queryKey: ["stock-report", filters],
    queryFn: () => api.get<{ rows: Movement[]; totals: Record<string, number>; actors: string[]; machines: string[] }>(`/stock/report${qs(filters)}`),
    retry: false,
  });
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <>
      <section className="sk-panel sk-noprint">
        <div className="sk-form" style={{ paddingTop: 18 }}>
          <label className="sk-field">{t.from}<input className="sk-input" type="date" value={draft.from} onChange={set("from")} /></label>
          <label className="sk-field">{t.to}<input className="sk-input" type="date" value={draft.to} onChange={set("to")} /></label>
          <label className="sk-field">{t.warehouse}<select className="sk-select" value={draft.warehouse} onChange={set("warehouse")}><option value="">{t.allWarehouses}</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="sk-field">{t.product}<select className="sk-select" value={draft.product} onChange={set("product")}><option value="">{t.allProducts}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="sk-field">{t.actor}<select className="sk-select" value={draft.actor} onChange={set("actor")}><option value="">{t.allPeople}</option>{(q.data?.actors ?? []).map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="sk-field">{t.machine}<select className="sk-select" value={draft.machine} onChange={set("machine")}><option value="">{t.allMachines}</option>{(q.data?.machines ?? []).map((a) => <option key={a}>{a}</option>)}</select></label>
          <div className="sk-row full">
            <button className="sk-btn primary" onClick={() => setFilters(draft)}>{t.apply}</button>
            <button className="sk-btn" disabled={!q.data?.rows.length} onClick={() => q.data && downloadCsv(q.data.rows, t, lang)}><Icon name="download" /> {t.csv}</button>
            <button className="sk-btn" onClick={() => window.print()}><Icon name="print" /> {t.print}</button>
          </div>
        </div>
      </section>
      {q.isError && <Message text={errText(q.error, t)} />}
      {q.data && (
        <>
          <section className="sk-stats">
            <div className="sk-stat"><div className="sk-stat-top cap">{t.records}<span className="sk-stat-icon"><Icon name="list" /></span></div><div className="sk-stat-value">{q.data.rows.length}</div></div>
            {Object.entries(q.data.totals).map(([u, v]) => (
              <div key={u} className="sk-stat"><div className="sk-stat-top cap">{unitOf(t, u)}<span className="sk-stat-icon"><Icon name="out" /></span></div><div className="sk-stat-value">{n2(v)}</div></div>
            ))}
          </section>
          <p className="sk-note">{t.cancelledExcluded}</p>
          <section className="sk-panel">
            <div className="sk-scroll">
              <table className="sk-table">
                <thead><tr><th>{t.date}</th><th>{t.warehouse}</th><th>{t.product}</th><th className="num">{t.quantity}</th><th>{t.actor}</th><th>{t.machine}</th><th>{t.noteCol}</th></tr></thead>
                <tbody>{q.data.rows.map((r) => (
                  <tr key={r.id}><td>{when(r.createdAt, lang)}</td><td>{r.warehouse}</td><td>{r.product}</td><td className="num">{n2(r.quantity)} {unitOf(t, r.unit)}</td><td>{r.actor}</td><td>{r.machine}</td><td>{r.note}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {q.data.rows.length === 0 && <div className="sk-empty"><Icon name="chart" />{t.noRows}</div>}
          </section>
        </>
      )}
    </>
  );
}

const EMPTY_PRODUCT = { id: 0, name: "", category: "DTF", unit: "bottle", minStock: "3", active: true };

function CategoriesPanel({ categories, products, t, onDone }: { categories: string[]; products: Product[]; t: Strings; onDone: () => void }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState("");
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setName(""); setRenaming(null); setError(""); onDone(); },
    onError: (e) => setError(errText(e, t)),
  });
  const locked = (c: string) => c === "DTF" || c === "UV";
  return (
    <section className="sk-panel">
      <PanelHead title={t.categories} sub={t.categoriesSub} />
      <div className="sk-panel-body">
        {categories.map((c) => (
          <div key={c} className="sk-catrow">
            {renaming?.from === c ? (
              <input className="sk-input" aria-label={t.categoryName} maxLength={40} value={renaming.to} onChange={(e) => setRenaming({ from: c, to: e.target.value })} />
            ) : (
              <span><Category value={c} /> <small>{t.productsCount(products.filter((p) => p.category === c).length)}</small></span>
            )}
            {!locked(c) && renaming?.from === c && (
              <>
                <button className="sk-btn small" onClick={() => run.mutate(() => api.put("/stock/categories", renaming))}>{t.save}</button>
                <button className="sk-btn small" onClick={() => setRenaming(null)}>{t.cancel}</button>
              </>
            )}
            {!locked(c) && renaming?.from !== c && (
              <>
                <button className="sk-btn small" onClick={() => setRenaming({ from: c, to: c })}>{t.rename}</button>
                <button className="sk-btn small" onClick={() => { if (confirm(t.deleteAsk(c))) run.mutate(() => api.del(`/stock/categories${qs({ name: c })}`)); }}>{t.del}</button>
              </>
            )}
          </div>
        ))}
        <div className="sk-catadd">
          <input className="sk-input" aria-label={t.categoryName} placeholder={t.categoryName} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="sk-btn" disabled={!name.trim() || run.isPending} onClick={() => run.mutate(() => api.post("/stock/categories", { name }))}><Icon name="plus" /> {t.addCategory}</button>
        </div>
        <Message text={error} />
      </div>
    </section>
  );
}

type SortKey = "name" | "category" | "minStock";

function ProductsTab({ data, t, onDone }: { data: Overview; t: Strings; onDone: () => void }) {
  const q = useQuery({ queryKey: ["stock-products"], queryFn: () => api.get<{ rows: Product[] }>("/stock/products") });
  const [form, setForm] = useState<typeof EMPTY_PRODUCT | null>(null);
  const [mins, setMins] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [cat, setCat] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [showCategories, setShowCategories] = useState(false);
  const warehouses = data.warehouses.filter((w) => w.active);
  const save = useMutation({
    mutationFn: async () => {
      const { id, ...body } = form!;
      if (!id) return api.post("/stock/products", body);
      await api.put(`/stock/products/${id}`, body);
      return api.put(`/stock/products/${id}/mins`, { mins: Object.fromEntries(warehouses.map((w) => [w.id, mins[w.id] ?? ""])) });
    },
    onSuccess: () => { setForm(null); setError(""); q.refetch(); onDone(); },
    onError: (e) => setError(errText(e, t)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/stock/products/${id}`),
    onSuccess: () => { setListError(""); q.refetch(); onDone(); },
    onError: (e) => setListError(errText(e, t)),
  });
  const rows = q.data?.rows ?? [];
  const needle = search.trim().toLowerCase();
  const shown = rows
    .filter((p) => (!cat || p.category === cat) && p.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;   // inactive products stay at the bottom
      const by = sort.key === "minStock" ? a.minStock - b.minStock : a[sort.key].localeCompare(b[sort.key]);
      return (by || a.name.localeCompare(b.name)) * sort.dir;
    });
  const head = (key: SortKey, label: string, num = false) => (
    <th className={num ? "num" : ""} aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
      <button className={`sk-sort ${sort.key === key ? "on" : ""}`} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir > 0 ? -1 : 1) : 1 })}>
        {label} <span aria-hidden="true">{sort.key === key ? (sort.dir > 0 ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
  return (
    <>
      <div className="sk-row">
        <button className="sk-btn primary" onClick={() => { setError(""); setForm({ ...EMPTY_PRODUCT, category: data.categories[0] ?? "DTF" }); }}><Icon name="plus" /> {t.add}</button>
        <button className="sk-btn" aria-expanded={showCategories} onClick={() => setShowCategories(!showCategories)}><Icon name="tag" /> {t.categories}</button>
      </div>
      {showCategories && <CategoriesPanel categories={data.categories} products={rows} t={t} onDone={() => { onDone(); q.refetch(); }} />}
      {form && (
        <section className="sk-panel sk-narrow">
          <PanelHead title={form.id ? t.editProduct : t.newProduct} />
          <div className="sk-form">
            <label className="sk-field full">{t.name}<input className="sk-input" value={form.name} maxLength={150} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="sk-field">{t.category}<select className="sk-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{data.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="sk-field">{t.unit}<select className="sk-select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{data.units.map((u) => <option key={u} value={u}>{unitOf(t, u)}</option>)}</select></label>
            <label className="sk-field">{t.defaultMin}<input className="sk-input" value={form.minStock} inputMode="decimal" onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></label>
            <label className="sk-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {t.active}</label>
            {!!form.id && (
              <div className="full sk-mins">
                <h3>{t.perWarehouseMin}</h3>
                <p className="sk-note">{t.perWarehouseHint}</p>
                <div>
                  {warehouses.map((w) => (
                    <label key={w.id} className="sk-field">{w.name}
                      <input className="sk-input" inputMode="decimal" placeholder={n2(Number(form.minStock) || 0)} value={mins[w.id] ?? ""} onChange={(e) => setMins({ ...mins, [w.id]: e.target.value })} />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="sk-row full">
              <button className="sk-btn primary" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>{t.save}</button>
              <button className="sk-btn" onClick={() => { setForm(null); setError(""); }}>{t.cancel}</button>
            </div>
            {error && <div className="full"><Message text={error} /></div>}
          </div>
        </section>
      )}
      <Message text={listError} />
      <div className="sk-filter sk-tools">
        <div className="sk-chips">
          <button className={cat ? "" : "on"} onClick={() => setCat("")}>{t.all} {rows.length}</button>
          {data.categories.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c} {rows.filter((p) => p.category === c).length}</button>)}
        </div>
        <label className="sk-search">
          <Icon name="search" />
          <input className="sk-input" aria-label={t.search} placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <section className="sk-panel">
        <div className="sk-scroll">
          <table className="sk-table">
            <thead><tr>{head("name", t.name)}{head("category", t.category)}<th>{t.unit}</th>{head("minStock", t.min, true)}<th>{t.status}</th><th /></tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.id}>
                <td><div className="sk-product"><ProductIcon name={p.name} />{p.name}</div></td><td><Category value={p.category} /></td><td>{unitOf(t, p.unit)}</td><td className="num">{n2(p.minStock)}</td>
                <td>{p.active ? t.active : <span className="sk-muted">{t.inactive}</span>}</td>
                <td className="num"><button className="sk-btn small" onClick={() => {
                  const own = data.products.find((x) => x.id === p.id)?.mins ?? {};
                  setMins(Object.fromEntries(Object.entries(own).map(([w, v]) => [w, String(v)])));
                  setError(""); setForm({ ...p, minStock: String(p.minStock) });
                }}>{t.edit}</button> <button className="sk-btn small" disabled={remove.isPending} onClick={() => { if (confirm(t.deleteProductAsk(p.name))) remove.mutate(p.id); }}>{t.del}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {q.data && shown.length === 0 && <div className="sk-empty"><Icon name="search" />{t.noRows}</div>}
      </section>
    </>
  );
}

interface TelegramState {
  chatId: string; enabled: boolean; summaryTime: string; lang: Lang; hasToken: boolean; tokenFromEnv: boolean;
  log: { id: number; status: string; attempts: number; lastError: string | null; createdAt: string }[];
}

function SettingsTab({ isAdmin, t, lang }: { isAdmin: boolean; t: Strings; lang: Lang }) {
  const tg = useQuery({ queryKey: ["stock-telegram"], queryFn: () => api.get<TelegramState>("/stock/telegram"), enabled: isAdmin });
  const auditQ = useQuery({ queryKey: ["stock-audit"], queryFn: () => api.get<{ rows: { id: number; actor: string; action: string; detail: string; createdAt: string }[] }>("/stock/audit") });
  const [edit, setEdit] = useState<Partial<TelegramState> & { token?: string }>({});
  const [msg, setMsg] = useState({ text: "", ok: false });
  const v = { chatId: "", enabled: false, summaryTime: "21:00", lang: "tr" as Lang, ...tg.data, ...edit };
  const run = (fn: () => Promise<unknown>, done: string) => fn().then(
    () => { setMsg({ text: done, ok: true }); setEdit({}); tg.refetch(); },
    (e) => setMsg({ text: errText(e, t), ok: false }),
  );
  return (
    <>
      {isAdmin && (
        <section className="sk-panel">
          <PanelHead title={t.telegram} sub={t.subs.settings} />
          <div className="sk-form">
            <label className="sk-field">{t.botToken}
              <input className="sk-input" type="password" autoComplete="off" disabled={tg.data?.tokenFromEnv} value={edit.token ?? ""} onChange={(e) => setEdit({ ...edit, token: e.target.value })} />
              <small>{tg.data?.tokenFromEnv ? t.tokenEnv : tg.data?.hasToken ? t.tokenSaved : ""}</small>
            </label>
            <label className="sk-field">{t.chatId}<input className="sk-input" value={v.chatId} onChange={(e) => setEdit({ ...edit, chatId: e.target.value })} /></label>
            <label className="sk-field">{t.summaryTime}<input className="sk-input" type="time" value={v.summaryTime} onChange={(e) => setEdit({ ...edit, summaryTime: e.target.value })} /></label>
            <label className="sk-field">{t.tgLang}
              <select className="sk-select" value={v.lang} onChange={(e) => setEdit({ ...edit, lang: e.target.value as Lang })}>
                <option value="en">English</option><option value="tr">Türkçe</option><option value="es">Español</option>
              </select>
            </label>
            <label className="sk-check full"><input type="checkbox" checked={v.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> {t.enabled}</label>
            <div className="sk-row full">
              <button className="sk-btn primary" onClick={() => run(() => api.put("/stock/telegram", { token: edit.token, chatId: v.chatId, enabled: v.enabled, summaryTime: v.summaryTime, lang: v.lang }), t.saved)}>{t.save}</button>
              <button className="sk-btn" disabled={!tg.data?.enabled} onClick={() => run(() => api.post("/stock/telegram/test"), t.sent)}>{t.sendTest}</button>
              <button className="sk-btn" disabled={!tg.data?.enabled} onClick={() => run(() => api.post("/stock/telegram/summary"), t.sent)}>{t.sendSummary}</button>
            </div>
            {msg.text && <div className="full"><Message {...msg} /></div>}
          </div>
          {!!tg.data?.log.length && (
            <>
              <PanelHead title={t.tgLog} />
              <div className="sk-scroll"><table className="sk-table">
                <thead><tr><th>{t.date}</th><th>{t.status}</th><th className="num">{t.attempts}</th><th>{t.detail}</th></tr></thead>
                <tbody>{tg.data.log.map((l) => <tr key={l.id}><td>{when(l.createdAt, lang)}</td><td>{l.status}</td><td className="num">{l.attempts}</td><td>{l.lastError}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </section>
      )}
      <section className="sk-panel">
        <PanelHead title={t.audit} />
        <div className="sk-scroll"><table className="sk-table">
          <thead><tr><th>{t.date}</th><th>{t.actor}</th><th>{t.action}</th><th>{t.detail}</th></tr></thead>
          <tbody>{(auditQ.data?.rows ?? []).map((a) => <tr key={a.id}><td>{when(a.createdAt, lang)}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.detail}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}

type Tab = "overview" | "in" | "out" | "transfer" | "adjust" | "history" | "report" | "products" | "settings";

export default function StockPanel() {
  const [lang, setLang] = useState<Lang>(loadLang);
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState(0);   // 0 = all warehouses
  const [syncMsg, setSyncMsg] = useState("");
  const t = STRINGS[lang];
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["stock-overview"], queryFn: () => api.get<Overview>("/stock/overview"), refetchInterval: 30000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["stock-overview"] }); qc.invalidateQueries({ queryKey: ["stock-recent"] }); };
  const sync = useMutation({
    mutationFn: () => api.post("/stock/warehouses/sync"),
    onSuccess: () => { setSyncMsg(""); refresh(); },
    onError: (e) => setSyncMsg(errText(e, t)),
  });
  const data = q.data;
  const activeWarehouses = useMemo(() => (data?.warehouses ?? []).filter((w) => w.active), [data]);
  const current = activeWarehouses.find((w) => w.id === selected)?.id ?? 0;
  const tabs: [Tab, string, string][] = [
    ["overview", t.overview, "grid"],
    ...(data?.canManage ? [["in", t.receive, "in"], ["out", t.use, "out"], ["transfer", t.transfer, "swap"], ["adjust", t.adjust, "check"]] as [Tab, string, string][] : []),
    ["history", t.history, "list"], ["report", t.report, "chart"],
    ...(data?.canManage ? [["products", t.products, "tag"], ["settings", t.settings, "gear"]] as [Tab, string, string][] : []),
  ];
  const place = activeWarehouses.find((w) => w.id === current)?.name;
  const eyebrow = tab !== "overview" && tab !== "history" ? t.title : place ? t.workspace(place) : t.allWarehouses;
  return (
    <div className="sk">
      <header className="sk-head">
        <div>
          <div className="sk-eyebrow">{eyebrow.toUpperCase()} <i /> {t.liveData}</div>
          <h1>{tabs.find(([k]) => k === tab)?.[1] ?? t.title}</h1>
          <p>{t.subs[tab]}</p>
        </div>
        <div className="sk-actions">
          <select className="sk-select sk-lang" aria-label="Language" value={lang} onChange={(e) => { const l = e.target.value as Lang; setLang(l); saveLang(l); }}>
            <option value="en">English</option><option value="tr">Türkçe</option><option value="es">Español</option>
          </select>
          {tab === "overview" && <button className="sk-btn" onClick={() => setTab("report")}><Icon name="chart" /> {t.report}</button>}
          {tab === "overview" && data?.canManage && <button className="sk-btn primary" onClick={() => setTab("in")}><Icon name="plus" /> {t.receive}</button>}
        </div>
      </header>
      <nav className="sk-tabs">
        {tabs.map(([key, label, icon]) => <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}><Icon name={icon} /> {label}</button>)}
      </nav>
      {q.isError && <Message text={errText(q.error, t)} />}
      {!data ? <div className="sk-empty">{t.loading}</div> : (
        <>
          {tab === "overview" && <OverviewTab data={data} selected={current} onSelect={setSelected} goTo={setTab} onSync={() => sync.mutate()} syncing={sync.isPending} t={t} lang={lang} />}
          {tab === "overview" && <Message text={syncMsg} />}
          {(tab === "in" || tab === "out") && <MoveTab key={tab} type={tab} warehouses={activeWarehouses} categories={data.categories} t={t} onDone={refresh} />}
          {tab === "transfer" && <TransferTab warehouses={activeWarehouses} products={data.products} t={t} onDone={refresh} />}
          {tab === "adjust" && <AdjustTab warehouses={activeWarehouses} products={data.products} initial={current} t={t} onDone={refresh} />}
          {tab === "history" && <HistoryTab warehouses={data.warehouses} selected={selected} onSelect={setSelected} canManage={data.canManage} t={t} lang={lang} onDone={refresh} />}
          {tab === "report" && <ReportTab warehouses={data.warehouses} products={data.products} t={t} lang={lang} />}
          {tab === "products" && <ProductsTab data={data} t={t} onDone={refresh} />}
          {tab === "settings" && <SettingsTab isAdmin={data.isAdmin} t={t} lang={lang} />}
        </>
      )}
    </div>
  );
}
