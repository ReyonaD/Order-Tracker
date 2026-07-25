import { VIEWS, GROUP_LABELS, ViewDef } from "../views";

interface Props {
  activeView: string;
  onSelect: (key: string) => void;
  canReports?: boolean;
  canSheets?: boolean;
}

const GROUP_ORDER: ViewDef["group"][] = ["all", "stores", "production", "deadline", "status"];

export default function Sidebar({ activeView, onSelect, canReports, canSheets }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Order Tracker</div>
      <nav>
        {(canReports || canSheets) && (
          <div className="sidebar-group">
            {canReports && (
              <button
                className={`sidebar-item sidebar-reports ${activeView === "reports" ? "active" : ""}`}
                onClick={() => onSelect("reports")}
              >
                📊 Reports
              </button>
            )}
            {canSheets && (
              <button
                className={`sidebar-item sidebar-reports ${activeView === "sheets" ? "active" : ""}`}
                onClick={() => onSelect("sheets")}
              >
                🧾 Sheets
              </button>
            )}
          </div>
        )}
        {GROUP_ORDER.map((group) => {
          const items = VIEWS.filter((v) => v.group === group);
          if (items.length === 0) return null;
          return (
            <div className="sidebar-group" key={group}>
              {GROUP_LABELS[group] && (
                <div className="sidebar-group-label">{GROUP_LABELS[group]}</div>
              )}
              {items.map((v) => (
                <button
                  key={v.key}
                  className={`sidebar-item ${activeView === v.key ? "active" : ""}`}
                  onClick={() => onSelect(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
