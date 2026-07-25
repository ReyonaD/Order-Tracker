import { useEffect, useRef, useState } from "react";
import { Dropdowns, FilterCond } from "../types";

interface Props {
  filters: FilterCond[];
  setFilters: (f: FilterCond[]) => void;
  dropdowns?: Dropdowns;
}

interface ColMeta {
  col: string;
  label: string;
  cat?: keyof Dropdowns; // value options come from a dropdown category
  opts?: string[]; // fixed value options
  boolean?: boolean;
}

const COLS: ColMeta[] = [
  { col: "status", label: "Status", opts: ["NEW", "FULFILLED", "CANCELLED"] },
  { col: "store", label: "Store" },
  { col: "shipping", label: "Pickup/Ship" },
  { col: "item", label: "Item", opts: ["DTF", "UV", "Sublimation", "T-shirt", "Sample", "Color Chart"] },
  { col: "designer", label: "Designer", cat: "designer" },
  { col: "upload", label: "Uploaded", cat: "uploadStatus" },
  { col: "print", label: "Print", cat: "printStatus" },
  { col: "machinist", label: "Operator", cat: "machinist" },
  { col: "machine", label: "Machine", cat: "machine" },
  { col: "urgent", label: "Urgent", opts: ["true", "false"], boolean: true },
];

export default function ColumnFilters({ filters, setFilters, dropdowns }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const meta = (col: string) => COLS.find((c) => c.col === col) ?? COLS[0];
  const optionsFor = (col: string): string[] | null => {
    const m = meta(col);
    if (m.opts) return m.opts;
    if (m.cat) return dropdowns?.[m.cat] ?? [];
    return null;
  };
  const isFreeText = (col: string) => {
    const m = meta(col);
    return !m.opts && !m.cat;
  };

  const update = (i: number, patch: Partial<FilterCond>) =>
    setFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => setFilters([...filters, { col: "status", op: "isnot", value: "" }]);
  const remove = (i: number) => setFilters(filters.filter((_, j) => j !== i));

  return (
    <div className="col-picker" ref={ref}>
      <button className="toolbar-btn" onClick={() => setOpen((o) => !o)}>
        ⧩ Filters{filters.length ? ` (${filters.length})` : ""}
      </button>
      {open && (
        <div className="filter-menu">
          {filters.length === 0 && <div className="muted small">No filters — add one to narrow the list.</div>}
          {filters.map((f, i) => {
            const m = meta(f.col);
            const opts = optionsFor(f.col);
            return (
              <div className="filter-row" key={i}>
                <select
                  value={f.col}
                  onChange={(e) => {
                    const col = e.target.value;
                    const nm = meta(col);
                    update(i, { col, value: "", op: nm.boolean || !isFreeText(col) ? (f.op === "contains" ? "is" : f.op) : f.op });
                  }}
                >
                  {COLS.map((c) => (
                    <option key={c.col} value={c.col}>{c.label}</option>
                  ))}
                </select>
                <select value={f.op} onChange={(e) => update(i, { op: e.target.value as FilterCond["op"] })}>
                  <option value="is">is</option>
                  <option value="isnot">is not</option>
                  {isFreeText(f.col) && <option value="contains">contains</option>}
                </select>
                {opts ? (
                  <select value={f.value} onChange={(e) => update(i, { value: e.target.value })}>
                    <option value="">—</option>
                    {opts.map((o) => (
                      <option key={o} value={o}>{m.boolean ? (o === "true" ? "Yes" : "No") : o}</option>
                    ))}
                  </select>
                ) : (
                  <input value={f.value} placeholder="value" onChange={(e) => update(i, { value: e.target.value })} />
                )}
                <button className="link-btn danger" title="Remove" onClick={() => remove(i)}>×</button>
              </div>
            );
          })}
          <div className="filter-actions">
            <button onClick={add}>+ Add filter</button>
            {filters.length > 0 && <button className="ghost" onClick={() => setFilters([])}>Clear all</button>}
          </div>
        </div>
      )}
    </div>
  );
}
