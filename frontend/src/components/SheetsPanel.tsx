import { ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "../api/client";
import { SheetCategoryDef, SheetCell, SheetRow, SheetsResponse } from "../types";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
type PeriodMode = "month" | "year" | "range" | "all";
const YEARS = [2025, 2026, 2027, 2028];
function n1(n: number): string { return (Math.round(n * 10) / 10).toLocaleString(); }
// override REPLACES; baseline is ADDED to the live auto value.
const effTotal = (c: SheetCell) => (c.totalOverride != null ? c.totalOverride : c.auto + (c.baseline ?? 0));
const autoShown = (c: SheetCell) => c.auto + (c.baseline ?? 0); // placeholder when no override

// Small number input that saves on blur / Enter. Empty => null.
function NumInput({ value, placeholder, onSave, suffix, width = 58 }: {
  value: number | null; placeholder?: string; onSave: (v: number | null) => void; suffix?: string; width?: number;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => { setText(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const t = text.trim();
    if (t === "") { if (value != null) onSave(null); return; }
    const v = Number(t);
    if (!isNaN(v) && v !== value) onSave(v);
  };
  return (
    <span className="num-input">
      <input style={{ width }} value={text} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {suffix}
    </span>
  );
}

export default function SheetsPanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [rangeFrom, setRangeFrom] = useState(thisMonth());
  const [rangeTo, setRangeTo] = useState(thisMonth());
  const [showAllWh, setShowAllWh] = useState(false);

  const period = useMemo(() => {
    switch (mode) {
      case "month": return { from: month, to: month };
      case "year": return { from: `${year}-01`, to: `${year}-12` };
      case "range": return rangeFrom <= rangeTo ? { from: rangeFrom, to: rangeTo } : { from: rangeTo, to: rangeFrom };
      case "all": return { from: "2025-01", to: thisMonth() };
    }
  }, [mode, month, year, rangeFrom, rangeTo]);

  const sheets = useQuery({
    queryKey: ["sheets", period],
    queryFn: () => api.get<SheetsResponse>(`/sheets/summary${qs(period)}`),
  });

  const editable = sheets.data?.editable ?? true;
  const pullSplit = useMutation({
    mutationFn: () => api.post<{ updated: number }>(`/sheets/pull-split${qs({ month })}`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["sheets", period] }); alert(`Pulled warehouse % for ${r.updated} store/type rows from DTF Monitor.`); },
    onError: (e) => alert(e instanceof Error ? e.message : "Pull failed"),
  });
  const save = useMutation({
    mutationFn: (b: { storeCode: string; type: string; splitPct?: Record<string, number> | null; totalOverride?: number | null }) =>
      api.put(`/sheets/entry`, { month, ...b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sheets", period] }),
    onError: (e) => alert(e instanceof Error ? e.message : "Save failed"),
  });

  const cats = sheets.data?.categories ?? [];
  const rows = sheets.data?.rows ?? [];
  const warehouses = (showAllWh ? sheets.data?.allWarehouses : sheets.data?.warehouses) ?? [];
  const baseWh = warehouses[0] ?? "Promo";
  const splitWh = warehouses.slice(1);

  const emptyCell: SheetCell = { auto: 0, splitPct: null, totalOverride: null };
  const cell = (r: SheetRow, key: string) => r.cells[key] ?? emptyCell;

  // warehouse percent + inches for a split cell
  const whPct = (c: SheetCell, wh: string): number => {
    const sp = c.splitPct || {};
    if (wh === baseWh) return Math.max(0, 100 - splitWh.reduce((s, w) => s + (sp[w] || 0), 0));
    return sp[wh] || 0;
  };
  const whInches = (c: SheetCell, wh: string) => (effTotal(c) * whPct(c, wh)) / 100;

  const setWhPct = (r: SheetRow, key: string, wh: string, v: number | null) => {
    const cur = { ...(cell(r, key).splitPct || {}) };
    if (v == null) delete cur[wh]; else cur[wh] = v;
    save.mutate({ storeCode: r.code, type: key, splitPct: Object.keys(cur).length ? cur : null });
  };

  const colSpanOf = (c: SheetCategoryDef) => (c.split ? 1 + warehouses.length : 1);
  const sum = (fn: (r: SheetRow) => number) => rows.reduce((s, r) => s + fn(r), 0);

  const exportCsv = () => {
    const head = ["Store"];
    for (const c of cats) {
      if (c.split) { head.push(`${c.label} TOTAL`); for (const w of warehouses) head.push(`${c.label} ${w}`); }
      else head.push(c.label);
    }
    const lines = [head.join(",")];
    for (const r of rows) {
      const out: (string | number)[] = [r.name];
      for (const c of cats) {
        const cl = cell(r, c.key);
        if (c.split) { out.push(n1(effTotal(cl))); for (const w of warehouses) out.push(n1(whInches(cl, w))); }
        else out.push(n1(effTotal(cl)));
      }
      lines.push(out.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hesap-takibi-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="reports">
      <div className="report-controls no-print">
        <div className="rc-row">
          <label>Period
            <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)}>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="range">Range</option>
              <option value="all">All time</option>
            </select>
          </label>
          {mode === "month" && <label>&nbsp;<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
          {mode === "year" && <label>&nbsp;
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>}
          {mode === "range" && <>
            <label>From <input type="month" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} /></label>
            <label>To <input type="month" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} /></label>
          </>}
          <label className="rc-check"><input type="checkbox" checked={showAllWh} onChange={(e) => setShowAllWh(e.target.checked)} /> Show all warehouses</label>
          <div className="spacer" />
          {mode === "month" && (
            <button className="btn-secondary" disabled={pullSplit.isPending}
              title="Fetch DTF/UV warehouse percentages from DTF Monitor for this month"
              onClick={() => {
                if (confirm(`Overwrite the DTF/UV warehouse % for ${month} with DTF Monitor's data?\n\nThis replaces the current percentages for this month only. Don't use it on older months whose split you entered/imported manually.`))
                  pullSplit.mutate();
              }}>
              {pullSplit.isPending ? "Pulling…" : "⟳ Pull warehouse %"}
            </button>
          )}
          <button className="btn-secondary" onClick={exportCsv} disabled={!rows.length}>⬇ CSV</button>
          <button className="btn-primary" onClick={() => window.print()} disabled={!rows.length}>⬇ PDF</button>
        </div>
      </div>

      <div className="report-print">
        <div className="report-head">
          <h1>Monthly account tracking — {mode === "month" ? month : mode === "year" ? year : mode === "all" ? "All time" : `${period.from} … ${period.to}`}</h1>
          <div className="report-sub">
            Inches/counts auto-computed from orders. For DTF/UV enter each warehouse's % (Promo = the rest).
            Empty products are hidden; a new product sold shows up automatically by its name.
            {!editable && <b> · Aggregated period — read-only (pick a single Month to edit).</b>}
          </div>
        </div>

        {sheets.isError && <div className="banner error">{(sheets.error as Error)?.message || "Failed"}</div>}
        {sheets.isLoading && <div className="report-empty">Loading…</div>}

        {rows.length > 0 && (
          <div className="pivot-wrap">
            <table className="report-table sheet-table">
              <thead>
                <tr className="sheet-group-row">
                  <th rowSpan={2}>Store</th>
                  {cats.map((c) => (
                    <th key={c.key} colSpan={colSpanOf(c)} rowSpan={c.split ? 1 : 2}
                      className={`grp ${c.key === "DTF" ? "sheet-dtf num" : c.key === "UV" ? "sheet-uv num" : "num"}`}>
                      {c.label}{c.split ? '"' : ""}
                    </th>
                  ))}
                </tr>
                <tr>
                  {cats.filter((c) => c.split).map((c) => (
                    <SplitHead key={c.key} warehouses={warehouses} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className="rt-key">{r.name}</td>
                    {cats.map((c) => {
                      const cl = cell(r, c.key);
                      if (c.split) {
                        return (
                          <SplitCells key={c.key} warehouses={warehouses} baseWh={baseWh}
                            totalNode={editable
                              ? <><NumInput value={cl.totalOverride} placeholder={n1(autoShown(cl))}
                                  onSave={(v) => save.mutate({ storeCode: r.code, type: c.key, totalOverride: v })} />
                                  {cl.totalOverride != null && <span className="ovr-dot" title="override">•</span>}</>
                              : <b>{n1(effTotal(cl))}</b>}
                            whInches={(w) => n1(whInches(cl, w))}
                            whPct={(w) => whPct(cl, w)}
                            pctInput={(w) => editable
                              ? <NumInput value={cl.splitPct?.[w] ?? null} placeholder="0" suffix="%" width={34}
                                  onSave={(v) => setWhPct(r, c.key, w, v)} />
                              : `${Math.round(whPct(cl, w))}%`} />
                        );
                      }
                      return (
                        <td key={c.key} className="num grp">
                          {editable
                            ? <NumInput value={cl.totalOverride} placeholder={n1(autoShown(cl))}
                                onSave={(v) => save.mutate({ storeCode: r.code, type: c.key, totalOverride: v })} />
                            : <b>{n1(effTotal(cl))}</b>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  {cats.map((c) => {
                    if (c.split) {
                      return (
                        <td key={c.key} className="num grp" colSpan={colSpanOf(c)}>
                          <b>{n1(sum((r) => effTotal(cell(r, c.key))))}</b>
                          <span className="muted"> ({warehouses.map((w) => `${w[0]} ${n1(sum((r) => whInches(cell(r, c.key), w)))}`).join(" / ")})</span>
                        </td>
                      );
                    }
                    return <td key={c.key} className="num grp"><b>{n1(sum((r) => effTotal(cell(r, c.key))))}</b></td>;
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="report-note">
          Inches = DTF/UV/Sublimation line-item lengths × quantity. Counts = quantity sold. Custom Shirt = all
          t-shirts; Sweatshirt = sweatshirts &amp; hoodies. DTF/UV split across warehouses by the % you enter
          (Promo = remainder); the split % will later auto-fill from DTF Monitor. • marks a manual override.
        </p>
      </div>
    </div>
  );
}

function SplitHead({ warehouses }: { warehouses: string[] }) {
  return (
    <>
      <th className="num grp">Total</th>
      {warehouses.map((w) => <th key={w} className="num wh-head">{w}</th>)}
    </>
  );
}

function SplitCells({ warehouses, baseWh, totalNode, whInches, whPct, pctInput }: {
  warehouses: string[]; baseWh: string; totalNode: ReactNode;
  whInches: (w: string) => string; whPct: (w: string) => number; pctInput: (w: string) => ReactNode;
}) {
  return (
    <>
      <td className="num grp total-cell">{totalNode}</td>
      {warehouses.map((w) => (
        <td key={w} className={w === baseWh ? "num wh-cell wh-base" : "num wh-cell"}>
          <div className="wh-in">{whInches(w)}</div>
          <div className="wh-pct">{w === baseWh ? `${Math.round(whPct(w))}%` : pctInput(w)}</div>
        </td>
      ))}
    </>
  );
}
