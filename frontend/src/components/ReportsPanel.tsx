import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api/client";
import { ReportCell, ReportGroup, ReportResponse, ReportSeriesPoint, Store } from "../types";

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

const GROUP_BYS: { key: string; label: string }[] = [
  { key: "shipping", label: "Pickup / Shipping" },
  { key: "store", label: "Store" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "item", label: "Item type" },
  { key: "status", label: "Status" },
  { key: "designer", label: "Designer" },
  { key: "operator", label: "Operator" },
  { key: "machine", label: "Machine" },
];
const groupLabelOf = (k: string) => GROUP_BYS.find((g) => g.key === k)?.label || k;

const FULFILLMENTS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pickup", label: "Pickup only" },
  { key: "shipping", label: "Shipping only" },
];

function money(n: number): string { return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function inch(n: number): string { return Math.round(n).toLocaleString() + '"'; }

// base measures + derived metrics
interface Base { count: number; revenue: number; units: number; inches: number }
interface Metric { key: string; label: string; get: (b: Base) => number; fmt: (n: number) => string }
const METRICS: Metric[] = [
  { key: "count", label: "Orders", get: (b) => b.count, fmt: (n) => n.toLocaleString() },
  { key: "revenue", label: "Revenue", get: (b) => b.revenue, fmt: money },
  { key: "avg", label: "Avg $", get: (b) => (b.count ? b.revenue / b.count : 0), fmt: money },
  { key: "units", label: "Units", get: (b) => b.units, fmt: (n) => n.toLocaleString() },
  { key: "inches", label: "Total inches", get: (b) => b.inches, fmt: inch },
];
const metricOf = (k: string) => METRICS.find((m) => m.key === k) || METRICS[0];
function accum(map: Map<string, Base>, key: string, c: Base) {
  const e = map.get(key) || { count: 0, revenue: 0, units: 0, inches: 0 };
  e.count += c.count; e.revenue += c.revenue; e.units += c.units; e.inches += c.inches;
  map.set(key, e);
}

// ---- time-series line chart (pure SVG, no deps) ----
function LineChart({ series, metric }: { series: ReportSeriesPoint[]; metric: Metric }) {
  if (!series.length) return <div className="report-empty">No data in range.</div>;
  const W = 1000, H = 240, padL = 60, padR = 14, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = series.length;
  const max = Math.max(1, ...series.map((s) => metric.get(s)));
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const line = series.map((s, i) => `${x(i)},${y(metric.get(s))}`).join(" ");
  const area = `${x(0)},${padT + innerH} ${line} ${x(n - 1)},${padT + innerH}`;
  const step = Math.max(1, Math.ceil(n / 10));
  return (
    <svg className="report-chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const gy = padT + innerH - f * innerH;
        return (
          <g key={f}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} className="chart-grid" />
            <text x={padL - 8} y={gy + 4} className="chart-ylab" textAnchor="end">{metric.fmt(max * f)}</text>
          </g>
        );
      })}
      <polygon points={area} className="chart-area" />
      <polyline points={line} className="chart-line" />
      {series.map((s, i) => (
        <circle key={i} cx={x(i)} cy={y(metric.get(s))} r={3} className="chart-dot">
          <title>{s.bucket}: {metric.fmt(metric.get(s))}</title>
        </circle>
      ))}
      {series.map((s, i) => (i % step === 0 || i === n - 1) ? (
        <text key={`x${i}`} x={x(i)} y={H - 9} className="chart-xlab" textAnchor="middle">{s.bucket}</text>
      ) : null)}
    </svg>
  );
}

// ---- multi-store checkbox dropdown ----
function StorePicker({ stores, value, onChange }: { stores: Store[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const label = value.length === 0 ? "All stores" : value.length === 1 ? (stores.find((s) => s.code === value[0])?.name || value[0]) : `${value.length} stores`;
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="store-picker" ref={ref}>
      <button type="button" className="sp-btn" onClick={() => setOpen((o) => !o)}>{label} ▾</button>
      {open && (
        <div className="sp-menu">
          <label className="sp-opt"><input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} /> All stores</label>
          <div className="sp-sep" />
          {stores.map((s) => (
            <label className="sp-opt" key={s.code}>
              <input type="checkbox" checked={value.includes(s.code)} onChange={() => toggle(s.code)} />
              <span className="store-badge" style={{ background: s.color }}>{s.code}</span>
              <span className="sp-name">{s.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportsPanel() {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(fmt(daysAgo(7)));
  const [customTo, setCustomTo] = useState(fmt(new Date()));
  const [stores, setStores] = useState<string[]>([]);
  const [fulfillment, setFulfillment] = useState("all");
  const [groupBy, setGroupBy] = useState("shipping");
  const [groupBy2, setGroupBy2] = useState(""); // "" = none
  const [metricKey, setMetricKey] = useState("count"); // pivot cell metric
  const [chartMetric, setChartMetric] = useState("count"); // time-series chart metric
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [sortCol, setSortCol] = useState("count"); // single-mode sort
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pivotSort, setPivotSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "__total__", dir: "desc" });

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

  const gb2 = groupBy2 && groupBy2 !== groupBy ? groupBy2 : "";
  const params = { from, to, store: stores.join(","), fulfillment, groupBy, groupBy2: gb2, includeCancelled: includeCancelled ? "1" : "0" };
  const report = useQuery({
    queryKey: ["report", params],
    queryFn: () => api.get<ReportResponse>(`/reports/summary${qs(params)}`),
  });

  const data = report.data;
  const totals = data?.totals;
  const isPivot = !!gb2 && !!data?.cells;
  const metric = metricOf(metricKey);

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
            <>
              <label>From <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
              <label>To <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
            </>
          )}
          <label>Stores
            <StorePicker stores={storesQuery.data?.stores ?? []} value={stores} onChange={setStores} />
          </label>
          <label>Fulfillment
            <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
              {FULFILLMENTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label>Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {GROUP_BYS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
          <label>Then by
            <select value={groupBy2} onChange={(e) => setGroupBy2(e.target.value)}>
              <option value="">— none —</option>
              {GROUP_BYS.filter((g) => g.key !== groupBy).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
          {gb2 && (
            <label>Cell value
              <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
                {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
          )}
          <label className="rc-check">
            <input type="checkbox" checked={includeCancelled} onChange={(e) => setIncludeCancelled(e.target.checked)} />
            Include cancelled
          </label>
          <div className="spacer" />
          <button className="btn-primary" onClick={() => window.print()} disabled={!data}>⬇ Export PDF</button>
        </div>
      </div>

      <div className="report-print">
        <div className="report-head">
          <h1>{storeLabel} — by {groupLabelOf(groupBy)}{gb2 && <> × {groupLabelOf(gb2)}</>}</h1>
          <div className="report-sub">
            {from} → {to}
            {fulfillment !== "all" && <> · {FULFILLMENTS.find((f) => f.key === fulfillment)?.label}</>}
            {gb2 && <> · cells show {metric.label}</>}
            {!includeCancelled && <> · excl. cancelled</>}
          </div>
        </div>

        {report.isError && <div className="banner error">{(report.error as Error)?.message || "Report failed"}</div>}
        {report.isLoading && <div className="report-empty">Loading…</div>}

        {data && totals && (
          <>
            <div className="report-cards">
              <div className="report-card"><span className="rc-num">{totals.count.toLocaleString()}</span><span className="rc-lbl">Orders</span></div>
              <div className="report-card"><span className="rc-num">{money(totals.revenue)}</span><span className="rc-lbl">Revenue</span></div>
              <div className="report-card"><span className="rc-num">{money(totals.count ? totals.revenue / totals.count : 0)}</span><span className="rc-lbl">Avg order</span></div>
              <div className="report-card"><span className="rc-num">{totals.units.toLocaleString()}</span><span className="rc-lbl">Units</span></div>
              <div className="report-card"><span className="rc-num">{inch(totals.inches)}</span><span className="rc-lbl">Total inches</span></div>
            </div>

            {data.hasBaseline && (
              <p className="report-note">
                Includes a <b>Setup (pre-integration)</b> row of {inch(data.baseline?.inches || 0)} /
                {" "}{(data.baseline?.units || 0).toLocaleString()} units for this month's early sales that predate the
                live integration (inches &amp; units only — no order count/revenue, and not split by pickup/shipping or day).
              </p>
            )}

            {isPivot
              ? <Pivot cells={data.cells!} rowDim={groupBy} colDim={gb2} metric={metric} sort={pivotSort} setSort={setPivotSort} />
              : <Single groups={data.groups ?? []} totals={totals} groupBy={groupBy} sortCol={sortCol} sortDir={sortDir}
                  onSort={(col) => {
                    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    else { setSortCol(col); setSortDir(col === "key" ? "asc" : "desc"); }
                  }} />}

            {data.series && data.series.length > 0 && (
              <div className="report-chart-box">
                <div className="chart-head">
                  <span className="chart-title">{data.seriesBucket === "hour" ? "By hour" : "By day"}</span>
                  <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)}>
                    {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
                <LineChart series={data.series} metric={metricOf(chartMetric)} />
              </div>
            )}

            {data.meta.overlaps && (
              <p className="report-note">
                Note: an order with several item types is counted under each type, so rows can exceed the order total;
                revenue is counted once per type, while Units and Total inches are that type's own.
              </p>
            )}
            <p className="report-note">Revenue = Shopify order total (orders without a stored price count as $0). Total inches = sum of DTF/UV/Sublimation lengths × quantity.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---- single-dimension table ----
function Single({ groups, totals, groupBy, sortCol, sortDir, onSort }: {
  groups: ReportGroup[]; totals: Base; groupBy: string; sortCol: string; sortDir: "asc" | "desc"; onSort: (c: string) => void;
}) {
  const measure = metricOf(sortCol);
  const sorted = useMemo(() => {
    const g = [...groups];
    g.sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortCol === "key") { av = a.key; bv = b.key; } else { av = measure.get(a); bv = measure.get(b); }
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return g;
  }, [groups, sortCol, sortDir, measure]);
  const barMax = sorted.reduce((mx, g) => Math.max(mx, measure.get(g)), 0) || 1;
  const arrow = (c: string) => (sortCol === c ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  return (
    <table className="report-table">
      <thead>
        <tr>
          <th className="sortable" onClick={() => onSort("key")}>{groupLabelOf(groupBy)}{arrow("key")}</th>
          {METRICS.map((m) => <th key={m.key} className="num sortable" onClick={() => onSort(m.key)}>{m.label}{arrow(m.key)}</th>)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((g) => (
          <tr key={g.key}>
            <td><div className="rt-key">{g.key}</div><div className="rt-bar" style={{ width: `${(measure.get(g) / barMax) * 100}%` }} /></td>
            {METRICS.map((m) => <td key={m.key} className="num">{m.fmt(m.get(g))}</td>)}
          </tr>
        ))}
        {sorted.length === 0 && <tr><td colSpan={METRICS.length + 1} className="report-empty">No orders in this range.</td></tr>}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          {METRICS.map((m) => <td key={m.key} className="num">{m.fmt(m.get(totals))}</td>)}
        </tr>
      </tfoot>
    </table>
  );
}

// ---- pivot (two-dimension cross-tab) ----
function Pivot({ cells, rowDim, colDim, metric, sort, setSort }: {
  cells: ReportCell[]; rowDim: string; colDim: string; metric: Metric;
  sort: { col: string; dir: "asc" | "desc" }; setSort: (s: { col: string; dir: "asc" | "desc" }) => void;
}) {
  const { rows, cols, cellMap, rowTot, colTot, grand } = useMemo(() => {
    const rowTot = new Map<string, Base>(), colTot = new Map<string, Base>(), cellMap = new Map<string, ReportCell>();
    const grand: Base = { count: 0, revenue: 0, units: 0, inches: 0 };
    for (const c of cells) {
      cellMap.set(c.r + "" + c.c, c);
      accum(rowTot, c.r, c); accum(colTot, c.c, c);
      grand.count += c.count; grand.revenue += c.revenue; grand.units += c.units; grand.inches += c.inches;
    }
    // columns sorted by column total of the metric (desc)
    const cols = [...colTot.keys()].sort((a, b) => metric.get(colTot.get(b)!) - metric.get(colTot.get(a)!));
    let rows = [...rowTot.keys()];
    rows.sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sort.col === "__key__") { av = a; bv = b; }
      else if (sort.col === "__total__") { av = metric.get(rowTot.get(a)!); bv = metric.get(rowTot.get(b)!); }
      else { av = metric.get(cellMap.get(a + "" + sort.col) as Base || { count: 0, revenue: 0, units: 0, inches: 0 }); bv = metric.get(cellMap.get(b + "" + sort.col) as Base || { count: 0, revenue: 0, units: 0, inches: 0 }); }
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return { rows, cols, cellMap, rowTot, colTot, grand };
  }, [cells, metric, sort]);

  const clickSort = (col: string) => {
    if (sort.col === col) setSort({ col, dir: sort.dir === "asc" ? "desc" : "asc" });
    else setSort({ col, dir: col === "__key__" ? "asc" : "desc" });
  };
  const arrow = (c: string) => (sort.col === c ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const val = (b?: Base) => (b ? metric.fmt(metric.get(b)) : "");

  return (
    <div className="pivot-wrap">
      <table className="report-table pivot">
        <thead>
          <tr>
            <th className="sortable" onClick={() => clickSort("__key__")}>{groupLabelOf(rowDim)} \ {groupLabelOf(colDim)}{arrow("__key__")}</th>
            {cols.map((c) => <th key={c} className="num sortable" onClick={() => clickSort(c)}>{c}{arrow(c)}</th>)}
            <th className="num sortable total-col" onClick={() => clickSort("__total__")}>Total{arrow("__total__")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td className="rt-key">{r}</td>
              {cols.map((c) => <td key={c} className="num">{val(cellMap.get(r + "" + c))}</td>)}
              <td className="num total-col">{val(rowTot.get(r))}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length + 2} className="report-empty">No orders in this range.</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {cols.map((c) => <td key={c} className="num">{val(colTot.get(c))}</td>)}
            <td className="num total-col">{val(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
