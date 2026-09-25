import { VIEWS, GROUP_LABELS, ViewDef } from "../views";

interface Props {
  activeView: string;
  onSelect: (key: string) => void;
  canReports?: boolean;
  canSheets?: boolean;
  canStaff?: boolean;
  canFinance?: boolean;
}

const GROUP_ORDER: ViewDef["group"][] = ["all", "stores", "production", "deadline", "status"];

export default function Sidebar({ activeView, onSelect, canReports, canSheets, canStaff, canFinance }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Order Tracker</div>
      <nav>
        <div className="sidebar-group">
            {/* Chase list is production-critical: everyone sees it. */}
            <button
              className={`sidebar-item sidebar-reports ${activeView === "chase" ? "active" : ""}`}
              onClick={() => onSelect("chase")}
            >
              🔥 Chase list
            </button>
            <button
              className={`sidebar-item sidebar-reports ${activeView === "floor" ? "active" : ""}`}
              onClick={() => onSelect("floor")}
            >
              🖨 Floor queue
            </button>
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
            {canStaff && (
              <button
                className={`sidebar-item sidebar-reports ${activeView === "staff" ? "active" : ""}`}
                onClick={() => onSelect("staff")}
              >
                👥 Staff
              </button>
            )}
            {canFinance && (
              <button
                className={`sidebar-item sidebar-reports ${activeView === "finance" ? "active" : ""}`}
                onClick={() => onSelect("finance")}
              >
                💰 Finance
              </button>
            )}
        </div>
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
