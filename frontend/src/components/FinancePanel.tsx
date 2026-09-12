import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// ── Income-statement structure ─────────────────────────────────────────────
type Section = "income" | "cogs" | "expense" | "memo";
interface FixedRow { key: string; label: string; note?: boolean }

const FIXED: Record<Section, FixedRow[]> = {
  income: [
    { key: "netSales", label: "Net sales" },
    { key: "shippingRevenue", label: "Shipping revenue" },
    { key: "otherIncome", label: "Other income", note: true },
  ],
  cogs: [
    { key: "uv", label: "UV", note: true },
    { key: "dtf", label: "DTF", note: true },
    { key: "tshirt", label: "Custom T-shirt", note: true },
    { key: "sweatshirt", label: "Sweatshirt", note: true },
    { key: "sublimation", label: "Sublimation", note: true },
    { key: "film", label: "DTF Film", note: true },
    { key: "hotPeelFilm", label: "Hot peel film", note: true },
    { key: "powder", label: "Powder", note: true },
    { key: "ink", label: "Ink", note: true },
    { key: "heatTape", label: "Heat tape", note: true },
    { key: "teflon", label: "Teflon", note: true },
  ],
  expense: [
    { key: "advertisement", label: "Advertisement", note: true },
    { key: "shippingApps", label: "Shipping apps, subs", note: true },
    { key: "bankFees", label: "Bank fees", note: true },
    { key: "otherExpenses", label: "Other expenses", note: true },
  ],
  memo: [
    { key: "jasaDebt", label: "Jasa debt (memo)", note: true },
    { key: "cashBalance", label: "Cash / bank balance (memo)", note: true },
  ],
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const YEARS = [2025, 2026, 2027, 2028];
const GENERAL = "__general__";
const DEFAULT_SPLIT: Partner[] = [{ name: "Alptekin", pct: 60 }, { name: "Sena", pct: 40 }];
// COGS auto-calc config (per store): warehouse-split categories (UV/DTF/…) carry
// {warehouses, price}; everything else is a flat measure × unit price. Both are
// keyed by the Sheets category key so any (incl. dynamic) product can be priced.
interface CogsCfg { split?: Record<string, { warehouses?: string[]; price?: number }>; prices?: Record<string, number> }
interface CogsCat { key: string; label: string; kind: string; split: boolean; finKey: string | null; total: number; wh?: Record<string, number> }
const slugId = (key: string) => "cogs_" + key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

type Vals = Record<string, number>;
type Notes = Record<string, string>;
interface CustomRow { id: string; section: Section; label: string }
interface Data { values?: Vals; notes?: Notes; custom?: CustomRow[]; hidden?: string[] }
interface Statement { storeCode: string; year: number; month: number; data: Data; updatedBy?: string | null }
interface Partner { name: string; pct: number }
interface Segment { start: number; partners: Partner[] } // start = YYYYMM, e.g. 202605
type SplitMap = Record<string, unknown>;

const num = (v: Vals | undefined, k: string) => Number(v?.[k]) || 0;
function sectionKeys(data: Data, sec: Section): string[] {
  const hidden = new Set(data.hidden || []);
  return [
    ...FIXED[sec].map((r) => r.key).filter((k) => !hidden.has(k)),
    ...(data.custom || []).filter((c) => c.section === sec).map((c) => c.id),
  ];
}
function compute(data: Data) {
  const v = data.values;
  const hidden = new Set(data.hidden || []);
  const sum = (sec: Section) => sectionKeys(data, sec).reduce((a, k) => a + num(v, k), 0);
  const revenue = (hidden.has("netSales") ? 0 : num(v, "netSales")) + (hidden.has("shippingRevenue") ? 0 : num(v, "shippingRevenue"));
  const totalIncome = sum("income");
  const cogs = sum("cogs");
  const expenses = sum("expense");
  return { revenue, totalIncome, cogs, expenses, net: totalIncome - cogs - expenses };
}
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => <span className={n < 0 ? "fin-neg" : ""}>{usd(n)}</span>;
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const csvEscape = (s: string) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => csvEscape(String(c))).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── partner splits (effective-dated segments) ──────────────────────────────
function normSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0] as Record<string, unknown>;
  if (first && typeof first.name === "string") return [{ start: 0, partners: raw as Partner[] }]; // legacy flat list
  return (raw as Segment[]).map((s) => ({ start: Number(s.start) || 0, partners: s.partners || [] }));
}
function pickPartners(segs: Segment[], ym: number): Partner[] {
  if (!segs.length) return DEFAULT_SPLIT;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  let chosen = sorted[0];
  for (const s of sorted) if (s.start <= ym) chosen = s;
  return chosen.partners.length ? chosen.partners : DEFAULT_SPLIT;
}

function MoneyInput({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
  const [text, setText] = useState(value == null || value === 0 ? "" : String(value));
  // Sync when the value is changed externally (e.g. COGS auto-fill), but don't
  // clobber what the user is typing (a "12." mid-decimal parses to the same number).
  useEffect(() => { if (Number(text || 0) !== (value || 0)) setText(value == null || value === 0 ? "" : String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input className="fin-amt" inputMode="decimal" value={text} placeholder="0.00"
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value.replace(/[^0-9.\-]/g, "")); onChange(isNaN(n) ? 0 : n); }} />
  );
}

export default function FinancePanel() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [store, setStore] = useState<string>(GENERAL);
  const [month, setMonth] = useState<number>(now.getMonth() + 1); // 0 = the store's own General
  const [editMode, setEditMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Data>>({});

  const storesQ = useQuery({ queryKey: ["stores"], queryFn: () => api.get<{ stores: { code: string; name: string; color: string }[] }>("/stores") });
  const stores = storesQ.data?.stores ?? [];
  const finQ = useQuery({ queryKey: ["finance", year], queryFn: () => api.get<{ statements: Statement[] }>(`/finance?year=${year}`) });
  const splitsQ = useQuery({ queryKey: ["financeSplits"], queryFn: () => api.get<{ splits: SplitMap }>("/finance/splits") });
  const cogsQ = useQuery({ queryKey: ["financeCogsConfig"], queryFn: () => api.get<{ config: Record<string, CogsCfg>; warehouses: string[] }>("/finance/cogs-config") });
  const cogsCfgMap = cogsQ.data?.config ?? {};
  const [cogsOpen, setCogsOpen] = useState(false);

  const saved = useMemo(() => {
    const m = new Map<string, Data>();
    for (const s of finQ.data?.statements ?? []) m.set(`${s.storeCode}|${s.month}`, s.data || {});
    return m;
  }, [finQ.data]);
  const splits: SplitMap = splitsQ.data?.splits ?? {};
  const segsFor = (code: string): Segment[] => {
    const s = normSegments(splits[code]);
    return s.length ? s : normSegments(splits["__default__"]);
  };
  const partnersAt = (code: string, m: number): Partner[] => pickPartners(segsFor(code), year * 100 + m);

  const key = `${store}|${year}|${month}`;
  const serverData: Data = saved.get(`${store}|${month}`) || {};
  const cur: Data = drafts[key] ?? serverData;
  const dirty = key in drafts;

  const mutate = (fn: (d: Data) => void) =>
    setDrafts((ds) => {
      const base = ds[key] ?? serverData;
      const clone: Data = { values: { ...(base.values || {}) }, notes: { ...(base.notes || {}) }, custom: [...(base.custom || [])], hidden: [...(base.hidden || [])] };
      fn(clone);
      return { ...ds, [key]: clone };
    });
  const setField = (k: string, n: number) => mutate((d) => { d.values![k] = n; });
  const setNote = (k: string, t: string) => mutate((d) => { d.notes![k] = t; });
  const hideFixed = (k: string) => mutate((d) => { if (!d.hidden!.includes(k)) d.hidden!.push(k); delete d.values![k]; delete d.notes![k]; });
  const restoreFixed = (k: string) => mutate((d) => { d.hidden = d.hidden!.filter((x) => x !== k); });
  const removeCustom = (id: string) => mutate((d) => { d.custom = (d.custom || []).filter((c) => c.id !== id); delete d.values![id]; delete d.notes![id]; });
  const addCustom = (section: Section) => {
    const label = window.prompt(`New ${section} line — name:`)?.trim();
    if (!label) return;
    mutate((d) => { d.custom!.push({ id: "c_" + Math.random().toString(36).slice(2, 9), section, label }); });
  };
  // Called by the COGS modal: set values/notes, ensure dynamic rows exist, and
  // prune the COGS section to this month's sold products. `keep` = row ids that
  // had a sale this month (fixed finKeys + dynamic slug ids); rows not sold and
  // with no value are hidden (fixed) or dropped (auto rows) so the list stays clean.
  const applyCogs = (values: Record<string, number>, notes: Record<string, string>, customRows: { id: string; label: string }[], keep: Set<string>) => {
    mutate((d) => {
      // Calculate is authoritative: wipe the whole COGS section first (fixed values
      // + previously auto-added rows) so stale numbers can't linger or double-count.
      for (const r of FIXED.cogs) { delete d.values![r.key]; delete d.notes![r.key]; }
      for (const c of (d.custom || [])) if (c.section === "cogs" && c.id.startsWith("cogs_")) { delete d.values![c.id]; delete d.notes![c.id]; }
      d.custom = (d.custom || []).filter((c) => !(c.section === "cogs" && c.id.startsWith("cogs_")));
      // add fresh auto rows + values from this month's calc
      for (const cr of customRows) d.custom!.push({ id: cr.id, section: "cogs", label: cr.label });
      for (const [k, v] of Object.entries(values)) { d.values![k] = v; if (notes[k]) d.notes![k] = notes[k]; }
      // hide fixed COGS rows that weren't sold this month and got no value
      d.hidden = (d.hidden || []).filter((x) => !FIXED.cogs.some((r) => r.key === x));
      for (const r of FIXED.cogs) {
        if (!(keep.has(r.key) || (Number(d.values![r.key]) || 0) > 0)) d.hidden.push(r.key);
      }
    });
  };

  const save = useMutation({
    mutationFn: () => api.put("/finance", { storeCode: store, year, month, data: cur }),
    onSuccess: () => { setDrafts((d) => { const n = { ...d }; delete n[key]; return n; }); qc.invalidateQueries({ queryKey: ["finance", year] }); },
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });

  const c = compute(cur);
  const storeName = stores.find((s) => s.code === store)?.name || store;
  const hiddenSet = new Set(cur.hidden || []);

  // ── exports ──
  const bilancoCsv = (sts: { code: string }[]): (string | number)[][] => {
    const { partnerNames, rows, tot } = computeBilanco(sts, saved, partnersAt);
    const out: (string | number)[][] = [["Month", "Revenue", "Expenses", "Profit", ...partnerNames, "Total"]];
    for (const r of rows) out.push([r.mn, f2(r.gelir), f2(r.gider), f2(r.fark), ...partnerNames.map((n) => f2(r.byPartner[n] || 0)), f2(r.fark)]);
    out.push(["Total", f2(tot.gelir), f2(tot.gider), f2(tot.fark), ...partnerNames.map((n) => f2(tot.byPartner[n] || 0)), f2(tot.fark)]);
    return out;
  };
  const statementCsv = (): (string | number)[][] => {
    const v = cur.values || {}, notes = cur.notes || {};
    const out: (string | number)[][] = [["Item", "Amount", "Note"]];
    const push = (label: string, id: string) => out.push([label, f2(Number(v[id]) || 0), notes[id] || ""]);
    out.push(["Revenue", f2(c.revenue), ""]);
    FIXED.income.filter((r) => !hiddenSet.has(r.key)).forEach((r) => push(r.label, r.key));
    customOf("income").forEach((r) => push(r.label, r.id));
    out.push(["COGS", f2(c.cogs), ""]);
    FIXED.cogs.filter((r) => !hiddenSet.has(r.key)).forEach((r) => push(r.label, r.key));
    customOf("cogs").forEach((r) => push(r.label, r.id));
    out.push(["Operating expenses", "", ""]);
    FIXED.expense.filter((r) => !hiddenSet.has(r.key)).forEach((r) => push(r.label, r.key));
    customOf("expense").forEach((r) => push(r.label, r.id));
    out.push(["Net income (P/L)", f2(c.net), ""]);
    FIXED.memo.filter((r) => !hiddenSet.has(r.key)).forEach((r) => push(r.label, r.key));
    customOf("memo").forEach((r) => push(r.label, r.id));
    return out;
  };
  const exportCsv = () => {
    if (store === GENERAL) downloadCsv(`finance_${year}_all-stores.csv`, bilancoCsv(stores));
    else if (month === 0) downloadCsv(`finance_${year}_${store}.csv`, bilancoCsv([{ code: store }]));
    else downloadCsv(`finance_${year}_${store}_${MONTHS[month - 1]}.csv`, statementCsv());
  };


  const line = (id: string, label: string, note: boolean, opts?: { memo?: boolean; onRemove?: () => void }) => (
    <tr key={key + "|" + id} className={opts?.memo ? "fin-memo" : ""}>
      <td className="fin-label indent">
        {label}
        {editMode && opts?.onRemove && <button className="fin-rowx" title="Remove row" onClick={opts.onRemove}>✕</button>}
      </td>
      <td className="fin-amt-cell"><MoneyInput value={cur.values?.[id]} onChange={(n) => setField(id, n)} /></td>
      <td className="fin-note-cell">{note && <input className="fin-note" value={cur.notes?.[id] ?? ""} placeholder="…" onChange={(e) => setNote(id, e.target.value)} />}</td>
    </tr>
  );
  const customOf = (sec: Section) => (cur.custom || []).filter((x) => x.section === sec);
  const hiddenOf = (sec: Section) => FIXED[sec].filter((r) => hiddenSet.has(r.key));
  const sectionTail = (sec: Section) => editMode ? (
    <tr className="fin-addrow"><td colSpan={3}>
      <button className="fin-add" onClick={() => addCustom(sec)}>+ Add {sec} line</button>
      {hiddenOf(sec).map((r) => <button key={r.key} className="fin-restore" title="Restore row" onClick={() => restoreFixed(r.key)}>+ {r.label}</button>)}
    </td></tr>
  ) : null;
  const fixedLines = (sec: Section) => FIXED[sec].filter((r) => !hiddenSet.has(r.key)).map((r) => line(r.key, r.label, !!r.note, { memo: sec === "memo", onRemove: () => hideFixed(r.key) }));
  const customLines = (sec: Section) => customOf(sec).map((r) => line(r.id, r.label, true, { onRemove: () => removeCustom(r.id) }));

  return (
    <div className="finance-panel">
      <div className="fin-toolbar">
        <select className="fin-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="fin-tabs">
          <button className={`fin-tab ${store === GENERAL ? "active" : ""}`} onClick={() => setStore(GENERAL)}>General</button>
          {stores.map((s) => (
            <button key={s.code} className={`fin-tab ${store === s.code ? "active" : ""}`} onClick={() => { setStore(s.code); setMonth(now.getMonth() + 1); }}
              style={store === s.code ? { borderColor: s.color, color: s.color } : undefined}>{s.name}</button>
          ))}
        </div>
        <div className="fin-export no-print">
          <button className="btn-secondary" onClick={() => window.print()}>⬇ PDF</button>
          <button className="btn-secondary" onClick={exportCsv}>⬇ CSV</button>
        </div>
      </div>

      {store === GENERAL ? (
        <Bilanco title={`Summary — ${year} — all stores`} stores={stores} saved={saved} partnersAt={partnersAt} />
      ) : (
        <>
          <div className="fin-months">
            <button className={`fin-month fin-month-gen ${month === 0 ? "active" : ""}`} onClick={() => setMonth(0)}>Summary</button>
            {MONTHS.map((mn, i) => (
              <button key={mn} className={`fin-month ${month === i + 1 ? "active" : ""}`} onClick={() => setMonth(i + 1)}>{mn.slice(0, 3)}</button>
            ))}
          </div>

          {month === 0 ? (
            <>
              <div className="fin-genbar"><button className="btn-secondary no-print" onClick={() => setSettingsOpen(true)}>⚙ Settings</button></div>
              <Bilanco title={`${storeName} — ${year}`} stores={[{ code: store }]} saved={saved} partnersAt={partnersAt} />
              {settingsOpen && (
                <SettingsModal store={store} storeName={storeName} year={year} segs={segsFor(store)} splits={splits} onClose={() => setSettingsOpen(false)} />
              )}
            </>
          ) : (
            <div className="fin-statement">
              <div className="fin-statement-head">
                <div className="fin-title">{storeName} — {MONTHS[month - 1]} {year} — Income Statement</div>
                <button className="fin-editbtn no-print" onClick={() => setCogsOpen(true)} title="Calculate COGS from Sheets">⚙ COGS</button>
                <button className={`fin-editbtn no-print ${editMode ? "active" : ""}`} onClick={() => setEditMode((e) => !e)}>
                  {editMode ? "✓ Done" : "✎ Edit rows"}
                </button>
              </div>
              {cogsOpen && (
                <CogsModal store={store} storeName={storeName} year={year} month={month}
                  cfg={cogsCfgMap[store] || {}} cfgMap={cogsCfgMap}
                  onApply={applyCogs} onClose={() => setCogsOpen(false)} />
              )}
              <table className={`fin-table ${editMode ? "fin-editing" : ""}`}>
                <thead><tr><th className="fin-c-label">Item</th><th className="fin-c-amt">Amount</th><th className="fin-c-note">Notes</th></tr></thead>
                <tbody>
                  <tr className="fin-strong fin-computed"><td className="fin-label">Revenue</td><td className="fin-amt-cell"><span className="fin-amt-out">{usd(c.revenue)}</span></td><td /></tr>
                  {fixedLines("income")}{customLines("income")}{sectionTail("income")}
                  <tr className="fin-strong fin-computed"><td className="fin-label">COGS</td><td className="fin-amt-cell"><span className="fin-amt-out">{usd(c.cogs)}</span></td><td /></tr>
                  {fixedLines("cogs")}{customLines("cogs")}{sectionTail("cogs")}
                  <tr className="fin-section-lbl"><td colSpan={3}>Operating expenses</td></tr>
                  {fixedLines("expense")}{customLines("expense")}{sectionTail("expense")}
                  <tr className="fin-strong fin-computed"><td className="fin-label">Net income (P/L)</td><td className="fin-amt-cell"><span className="fin-amt-out">{usd(c.net)}</span></td><td /></tr>
                  {fixedLines("memo")}{customLines("memo")}{sectionTail("memo")}
                </tbody>
              </table>
              <div className="fin-actions">
                <button className="fin-save" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
                </button>
                {(finQ.data?.statements || []).find((s) => s.storeCode === store && s.month === month)?.updatedBy && (
                  <span className="fin-meta">last edited by {(finQ.data!.statements).find((s) => s.storeCode === store && s.month === month)!.updatedBy}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Bilanço computation (shared by the table + CSV export) ──────────────────
interface BilRow { mn: string; gelir: number; gider: number; fark: number; byPartner: Record<string, number> }
function computeBilanco(stores: { code: string }[], saved: Map<string, Data>, partnersAt: (code: string, m: number) => Partner[]) {
  const partnerNames: string[] = [];
  for (const s of stores) for (let m = 1; m <= 12; m++) for (const p of partnersAt(s.code, m)) if (p.name && !partnerNames.includes(p.name)) partnerNames.push(p.name);
  const share = (net: number, partners: Partner[], name: string) => {
    const total = partners.reduce((a, p) => a + (Number(p.pct) || 0), 0) || 1;
    const p = partners.find((x) => x.name === name);
    return p ? net * ((Number(p.pct) || 0) / total) : 0;
  };
  const rows: BilRow[] = MONTHS.map((mn, i) => {
    const month = i + 1;
    let gelir = 0, gider = 0, fark = 0;
    const byPartner: Record<string, number> = Object.fromEntries(partnerNames.map((n) => [n, 0]));
    for (const s of stores) {
      const d = saved.get(`${s.code}|${month}`);
      if (!d) continue;
      const c = compute(d);
      gelir += c.totalIncome; gider += c.cogs + c.expenses; fark += c.net;
      const partners = partnersAt(s.code, month);
      for (const n of partnerNames) byPartner[n] += share(c.net, partners, n);
    }
    return { mn, gelir, gider, fark, byPartner };
  });
  const tot = rows.reduce((a, r) => {
    a.gelir += r.gelir; a.gider += r.gider; a.fark += r.fark;
    for (const n of partnerNames) a.byPartner[n] = (a.byPartner[n] || 0) + (r.byPartner[n] || 0);
    return a;
  }, { gelir: 0, gider: 0, fark: 0, byPartner: {} as Record<string, number> });
  return { partnerNames, rows, tot };
}

// ── Bilanço table: months × Gelir / Gider / Fark / partner split ────────────
function Bilanco({ title, stores, saved, partnersAt }:
  { title: string; stores: { code: string }[]; saved: Map<string, Data>; partnersAt: (code: string, m: number) => Partner[] }) {
  const { partnerNames, rows, tot } = computeBilanco(stores, saved, partnersAt);

  return (
    <div className="fin-statement fin-general">
      <div className="fin-title">{title}</div>
      <table className="fin-table fin-overview">
        <thead>
          <tr>
            <th rowSpan={2}>Month</th><th rowSpan={2}>Revenue</th><th rowSpan={2}>Expenses</th><th rowSpan={2}>Profit</th>
            <th colSpan={partnerNames.length + 1} className="fin-split-head">Distribution</th>
          </tr>
          <tr>{partnerNames.map((n) => <th key={n}>{n}</th>)}<th>Total</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mn}>
              <td className="fin-label">{r.mn}</td>
              <td>{money(r.gelir)}</td><td>{money(r.gider)}</td><td className="fin-split-cell">{money(r.fark)}</td>
              {partnerNames.map((n) => <td key={n}>{money(r.byPartner[n] || 0)}</td>)}
              <td className="fin-split-cell">{money(r.fark)}</td>
            </tr>
          ))}
          <tr className="fin-strong">
            <td className="fin-label">Total</td>
            <td>{money(tot.gelir)}</td><td>{money(tot.gider)}</td><td className="fin-split-cell">{money(tot.fark)}</td>
            {partnerNames.map((n) => <td key={n}>{money(tot.byPartner[n] || 0)}</td>)}
            <td className="fin-split-cell">{money(tot.fark)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Editable, effective-dated partner split for one store ───────────────────
function SplitEditor({ store, storeName, year, segs, splits }:
  { store: string; storeName: string; year: number; segs: Segment[]; splits: SplitMap }) {
  const qc = useQueryClient();
  const init: Segment[] = segs.length ? segs.map((s) => ({ start: s.start || year * 100 + 1, partners: s.partners.length ? s.partners : [...DEFAULT_SPLIT] }))
    : [{ start: year * 100 + 1, partners: [...DEFAULT_SPLIT] }];
  const [rows, setRows] = useState<Segment[]>(init);

  const upd = (fn: (segs: Segment[]) => void) => setRows((r) => { const c = r.map((s) => ({ start: s.start, partners: s.partners.map((p) => ({ ...p })) })); fn(c); return c; });
  const save = useMutation({
    mutationFn: () => api.put("/finance/splits", { splits: { ...splits, [store]: rows.map((s) => ({ start: s.start, partners: s.partners.map((p) => ({ name: p.name.trim(), pct: Number(p.pct) || 0 })).filter((p) => p.name) })) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["financeSplits"] }),
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div className="fin-split-editor">
      <div className="fin-title">{storeName} — profit split (per period)</div>
      {rows.sort((a, b) => a.start - b.start).map((seg, si) => {
        const total = seg.partners.reduce((a, p) => a + (Number(p.pct) || 0), 0);
        const m0 = Math.max(1, seg.start % 100), y0 = Math.floor(seg.start / 100) || year;
        return (
          <div className="fin-seg" key={si}>
            <div className="fin-seg-head">
              <span>Effective from</span>
              <select value={m0} onChange={(e) => upd((c) => { c[si].start = y0 * 100 + Number(e.target.value); })}>
                {MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}
              </select>
              <select value={y0} onChange={(e) => upd((c) => { c[si].start = Number(e.target.value) * 100 + m0; })}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              {rows.length > 1 && <button className="fin-rowx" title="Remove period" onClick={() => upd((c) => { c.splice(si, 1); })}>remove period ✕</button>}
            </div>
            <table className="fin-splitedit"><tbody>
              {seg.partners.map((p, pi) => (
                <tr key={pi}>
                  <td><input className="fin-pname" value={p.name} placeholder="Partner" onChange={(e) => upd((c) => { c[si].partners[pi].name = e.target.value; })} /></td>
                  <td><input className="fin-pct" inputMode="decimal" value={p.pct} onChange={(e) => upd((c) => { c[si].partners[pi].pct = Number(e.target.value.replace(/[^0-9.]/g, "")) || 0; })} /> %</td>
                  <td><button className="fin-rowx" title="Remove" onClick={() => upd((c) => { c[si].partners.splice(pi, 1); })}>✕</button></td>
                </tr>
              ))}
              <tr><td colSpan={3}>
                <button className="fin-add" onClick={() => upd((c) => { c[si].partners.push({ name: "", pct: 0 }); })}>+ Add partner</button>
                <span className="fin-meta" style={{ marginLeft: 10 }}>Total {total}% (split proportionally)</span>
              </td></tr>
            </tbody></table>
          </div>
        );
      })}
      <div className="fin-actions">
        <button className="fin-add" onClick={() => upd((c) => { const last = c[c.length - 1]; c.push({ start: year * 100 + 1, partners: last ? last.partners.map((p) => ({ ...p })) : [...DEFAULT_SPLIT] }); })}>+ Add period</button>
        <button className="fin-save" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save split"}</button>
      </div>
    </div>
  );
}

// ── Settings modal (per store): profit split ────────────────────────────────
function SettingsModal({ store, storeName, year, segs, splits, onClose }:
  { store: string; storeName: string; year: number; segs: Segment[]; splits: SplitMap; onClose: () => void }) {
  return (
    <div className="fin-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fin-modal-card">
        <div className="fin-modal-head"><b>{storeName} — Settings</b><button className="fin-modal-x" onClick={onClose}>✕</button></div>
        <div className="fin-modal-body">
          <SplitEditor key={store} store={store} storeName={storeName} year={year} segs={segs} splits={splits} />
        </div>
      </div>
    </div>
  );
}

// ── COGS calculation modal (dynamic: reflects the month's Sheets categories) ─
function CogsModal({ store, storeName, year, month, cfg, cfgMap, onApply, onClose }:
  { store: string; storeName: string; year: number; month: number; cfg: CogsCfg; cfgMap: Record<string, CogsCfg>; onApply: (v: Record<string, number>, n: Record<string, string>, c: { id: string; label: string }[], keep: Set<string>) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // On open: first pull the latest warehouse split from DTF Monitor (non-fatal),
  // THEN load measures — so the category list + splits reflect the newest data.
  const measQ = useQuery({
    queryKey: ["cogsMeasures", store, year, month],
    queryFn: async () => {
      await api.post("/finance/pull-split", { year, month }).catch(() => {});
      return api.get<{ warehouses: string[]; categories: CogsCat[] }>(`/finance/cogs-measures?store=${encodeURIComponent(store)}&year=${year}&month=${month}`);
    },
    refetchOnWindowFocus: false,
  });
  const warehouses = measQ.data?.warehouses ?? [];
  const cats = measQ.data?.categories ?? [];
  const splitCats = cats.filter((c) => c.split);
  const otherCats = cats.filter((c) => !c.split);

  // Prices are edited as strings (so "0.10" can be typed) and parsed to numbers on use.
  const numToStr = (n?: number) => (n == null || n === 0 ? "" : String(n));
  const [splitCfg, setSplitCfg] = useState<Record<string, { warehouses: string[]; price: string }>>(
    () => Object.fromEntries(Object.entries(cfg.split ?? {}).map(([k, v]) => [k, { warehouses: v.warehouses ?? [], price: numToStr(v.price) }])));
  const [prices, setPrices] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(cfg.prices ?? {}).map(([k, v]) => [k, numToStr(v as number)])));
  const [busy, setBusy] = useState(false);
  const scfg = (k: string) => splitCfg[k] ?? { warehouses: [] as string[], price: "" };
  const setScfg = (k: string, patch: Partial<{ warehouses: string[]; price: string }>) =>
    setSplitCfg((m) => ({ ...m, [k]: { ...scfg(k), ...patch } }));

  const numSplit = () => Object.fromEntries(Object.entries(splitCfg).map(([k, v]) => [k, { warehouses: v.warehouses, price: Number(v.price) || 0 }]));
  const numPrices = () => Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Number(v) || 0]));
  const persist = () => api.put("/finance/cogs-config", { config: { ...cfgMap, [store]: { split: numSplit(), prices: numPrices() } } });
  const saveCfg = useMutation({
    mutationFn: persist,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["financeCogsConfig"] }),
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });

  const calcFill = async () => {
    setBusy(true);
    try {
      // Uses the categories already loaded when the modal opened (which pulled the
      // latest split first) — so what fills is exactly what's shown.
      const values: Record<string, number> = {}, notes: Record<string, string> = {}, customRows: { id: string; label: string }[] = [];
      const put = (c: CogsCat, val: number, note: string) => {
        if (c.finKey) { values[c.finKey] = val; notes[c.finKey] = note; }
        else { const id = slugId(c.key); values[id] = val; notes[id] = note; customRows.push({ id, label: c.label }); }
      };
      for (const c of cats) {
        if (c.split) {
          const sc = scfg(c.key);
          const price = Number(sc.price) || 0;
          if (!(price > 0) || !sc.warehouses.length) continue;
          const inch = sc.warehouses.reduce((a, w) => a + (c.wh?.[w] || 0), 0);
          put(c, r2(inch * price), `${sc.warehouses.join("+")} ${r2(inch)} in × ${price}`);
        } else {
          const p = Number(prices[c.key]) || 0;
          if (!(p > 0)) continue;
          put(c, r2(c.total * p), `${c.total} ${c.kind === "inches" ? "in" : "pc"} × ${p}`);
        }
      }
      // rows sold this month (present in Sheets) — used to prune the COGS list
      const keep = new Set<string>();
      for (const c of cats) if (c.total > 0) keep.add(c.finKey || slugId(c.key));
      await persist();
      qc.invalidateQueries({ queryKey: ["financeCogsConfig"] });
      onApply(values, notes, customRows, keep);
      onClose();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };

  return (
    <div className="fin-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fin-modal-card">
        <div className="fin-modal-head"><b>{storeName} — COGS from Sheets</b><button className="fin-modal-x" onClick={onClose}>✕</button></div>
        <div className="fin-modal-body">
          <div className="fin-hint">Opening refreshes the latest warehouse split from Sheets, then lists {MONTHS[month - 1]} {year}'s categories. UV/DTF: pick warehouses + price per inch. Others: measure × unit price.</div>
          {measQ.isLoading ? <div className="fin-hint">Refreshing Sheets &amp; loading categories…</div> : (
            <>
              {splitCats.map((c) => {
                const sc = scfg(c.key);
                const unpriced = c.total > 0 && !(Number(sc.price) > 0);
                return (
                  <div className={`fin-cogs-row${unpriced ? " fin-unpriced" : ""}`} key={c.key}>
                    <div className="fin-cogs-lbl"><span>{c.label}{unpriced && <span className="fin-newbadge">NEW</span>}</span><span className="fin-cogs-tot">{c.total} in</span></div>
                    <div className="fin-cogs-wh">
                      {warehouses.map((wh) => (
                        <label key={wh} className="fin-wh"><input type="checkbox" checked={sc.warehouses.includes(wh)}
                          onChange={() => setScfg(c.key, { warehouses: sc.warehouses.includes(wh) ? sc.warehouses.filter((x) => x !== wh) : [...sc.warehouses, wh] })} /> {wh}</label>
                      ))}
                    </div>
                    <div className="fin-cogs-price">$ <input className="fin-pct" inputMode="decimal" value={sc.price} placeholder="0"
                      onChange={(e) => setScfg(c.key, { price: e.target.value.replace(/[^0-9.]/g, "") })} /> /inch</div>
                  </div>
                );
              })}
              {otherCats.length > 0 && <div className="fin-cogs-sep">Other products (measure × price)</div>}
              <table className="fin-splitedit"><tbody>
                {otherCats.map((c) => {
                  const unpriced = c.total > 0 && !(Number(prices[c.key]) > 0);
                  return (
                  <tr key={c.key} className={unpriced ? "fin-unpriced" : ""}>
                    <td className="fin-label">{c.label}{!c.finKey && <span className="fin-cogs-dyn" title="Will be added as a custom COGS row">＋</span>}{unpriced && <span className="fin-newbadge">NEW</span>}</td>
                    <td className="fin-cogs-tot">{c.total} {c.kind === "inches" ? "in" : "pc"}</td>
                    <td>$ <input className="fin-pct" inputMode="decimal" value={prices[c.key] ?? ""} placeholder="0"
                      onChange={(e) => setPrices((pr) => ({ ...pr, [c.key]: e.target.value.replace(/[^0-9.]/g, "") }))} /></td>
                    <td className="fin-price-unit">per {c.kind === "inches" ? "inch" : "pc"}</td>
                  </tr>
                  );
                })}
              </tbody></table>
            </>
          )}
        </div>
        <div className="fin-actions" style={{ padding: "0 16px 16px" }}>
          <button className="btn-ghost" onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>{saveCfg.isPending ? "Saving…" : "Save settings"}</button>
          <button className="fin-save" onClick={calcFill} disabled={busy || measQ.isLoading}>{busy ? "Calculating…" : `Calculate & fill ${MONTHS[month - 1]}`}</button>
        </div>
      </div>
    </div>
  );
}
