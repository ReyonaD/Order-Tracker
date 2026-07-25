import { useState } from "react";
import { FacetsResponse, FacetSelection } from "../types";

interface Props {
  facets?: FacetsResponse;
  selection: FacetSelection;
  onSelect: (sel: FacetSelection) => void;
}

const EMPTY: FacetSelection = { month: "", day: "", store: "", pickup: "" };

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}
function dayLabel(d: string): string {
  const [y, mo, da] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, da));
  return dt.toLocaleDateString(undefined, { day: "numeric", weekday: "short", timeZone: "UTC" });
}

export default function FacetPanel({ facets, selection, onSelect }: Props) {
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, k: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    n.has(k) ? n.delete(k) : n.add(k);
    setter(n);
  };

  const by = facets?.by ?? "store";
  // Map a clicked group key to the right selection field.
  const groupSel = (month: string, day: string, key: string): FacetSelection =>
    by === "pickup"
      ? { month, day, store: "", pickup: key === "Pickup" ? "true" : "false" }
      : { month, day, store: key, pickup: "" };
  const groupActive = (key: string) =>
    by === "pickup"
      ? selection.pickup === (key === "Pickup" ? "true" : "false")
      : selection.store === key;

  return (
    <div className="facet-panel">
      <button className={`facet-all ${!selection.month && !selection.day ? "active" : ""}`} onClick={() => onSelect(EMPTY)}>
        <span>All</span>
        <span className="facet-count">{facets?.total ?? ""}</span>
      </button>

      {(facets?.months ?? []).map((mf) => {
        const monthOpen = openMonths.has(mf.month) || selection.month === mf.month;
        const monthActive = selection.month === mf.month && !selection.day;
        return (
          <div className="facet-month" key={mf.month}>
            <div className={`facet-row ${monthActive ? "active" : ""}`}>
              <button className="facet-caret" onClick={() => toggle(openMonths, mf.month, setOpenMonths)}>{monthOpen ? "▾" : "▸"}</button>
              <button className="facet-label" onClick={() => onSelect({ ...EMPTY, month: mf.month })}>{monthLabel(mf.month)}</button>
              <span className="facet-count">{mf.total}</span>
            </div>

            {monthOpen && mf.days.map((df) => {
              const dayOpen = openDays.has(df.day) || (selection.day === df.day);
              const dayActive = selection.day === df.day && !selection.store && !selection.pickup;
              return (
                <div className="facet-day" key={df.day}>
                  <div className={`facet-row facet-row-day ${dayActive ? "active" : ""}`}>
                    <button className="facet-caret" onClick={() => toggle(openDays, df.day, setOpenDays)}>{dayOpen ? "▾" : "▸"}</button>
                    <button className="facet-label" onClick={() => onSelect({ ...EMPTY, month: mf.month, day: df.day })}>{dayLabel(df.day)}</button>
                    <span className="facet-count">{df.total}</span>
                  </div>
                  {dayOpen && (
                    <div className="facet-sub">
                      {df.groups.map((g) => (
                        <button
                          key={g.key}
                          className={`facet-subrow ${dayActive === false && groupActive(g.key) && selection.day === df.day ? "active" : ""}`}
                          onClick={() => onSelect(groupSel(mf.month, df.day, g.key))}
                        >
                          <span>{g.key}</span>
                          <span className="facet-count">{g.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
