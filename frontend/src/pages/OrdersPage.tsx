import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, qs } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Dropdowns, FacetSelection, FacetsResponse, FilterCond, OrdersResponse, PermissionsMatrix, Role } from "../types";

const PREVIEW_ROLES: Role[] = ["DESIGNER", "MACHINIST", "CUSTOMER_SERVICE", "VIEWER"];
import { VIEWS } from "../views";
import Sidebar from "../components/Sidebar";
import FacetPanel from "../components/FacetPanel";
import OrdersTable from "../components/OrdersTable";
import ReportsPanel from "../components/ReportsPanel";
import SheetsPanel from "../components/SheetsPanel";

export default function OrdersPage() {
  const { user, logout } = useAuth();
  const [activeView, setActiveView] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const emptyFacet: FacetSelection = { month: "", day: "", store: "", pickup: "" };
  const [facet, setFacet] = useState<FacetSelection>(emptyFacet);
  const [facetOpen, setFacetOpen] = useState(() => localStorage.getItem("ot_facet_open") !== "false");
  const [columnFilters, setColumnFilters] = useState<FilterCond[]>([]);
  const [previewRole, setPreviewRole] = useState(""); // admin "view as" role
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const isReports = activeView === "reports";
  const isSheets = activeView === "sheets";
  const isPanel = isReports || isSheets;
  const canReports = user?.role === "ADMIN" || !!user?.canViewReports;
  const canSheets = user?.role === "ADMIN" || !!user?.canViewSheets;
  const view = useMemo(() => VIEWS.find((v) => v.key === activeView) ?? VIEWS[0], [activeView]);

  // Single-store views break the facet down by pickup/shipping; multi-store views by store.
  const facetBy = view.params.store ? "pickup" : "store";

  // Base params (view + status + search) drive the facet panel.
  const baseParams = {
    ...view.params,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search ? { search } : {}),
  };
  const params = {
    ...baseParams,
    ...(facet.month ? { month: facet.month } : {}),
    ...(facet.day ? { day: facet.day } : {}),
    ...(facet.store && !view.params.store ? { store: facet.store } : {}),
    ...(facet.pickup ? { pickup: facet.pickup } : {}),
    ...(columnFilters.length ? { filters: JSON.stringify(columnFilters) } : {}),
    page,
    pageSize,
  };

  const ordersQuery = useQuery({
    queryKey: ["orders", params],
    queryFn: () => api.get<OrdersResponse>(`/orders${qs(params)}`),
    // Poll so newly-arrived Shopify orders show up without a manual refresh.
    refetchInterval: 20000,
    enabled: !isPanel,
  });

  const facetsQuery = useQuery({
    queryKey: ["facets", baseParams, facetBy],
    queryFn: () => api.get<FacetsResponse>(`/orders/facets${qs({ ...baseParams, by: facetBy })}`),
    enabled: !isPanel,
  });

  const dropdownsQuery = useQuery({
    queryKey: ["dropdowns"],
    queryFn: () => api.get<{ options: Dropdowns }>("/dropdowns"),
    staleTime: 5 * 60 * 1000,
  });

  const permsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.get<{ permissions: PermissionsMatrix }>("/config/permissions"),
    staleTime: 5 * 60 * 1000,
  });
  const permissions = permsQuery.data?.permissions;

  // Admins can preview the app as another role (see what that role sees/edits).
  const isAdmin = user?.role === "ADMIN";
  const previewing = isAdmin && previewRole !== "";
  const effectiveRole: Role = previewing ? (previewRole as Role) : user!.role;
  const effectivePerms = previewing ? permissions?.[previewRole] : permissions?.[user!.role];

  const total = ordersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="app-layout">
      <Sidebar
        activeView={activeView}
        canReports={canReports}
        canSheets={canSheets}
        onSelect={(k) => {
          setActiveView(k);
          setFacet(emptyFacet);
          setPage(1);
        }}
      />

      {!isPanel && (facetOpen ? (
        <div className="facet-col">
          <div className="facet-head">
            <span>Filters</span>
            <button
              className="facet-toggle"
              title="Hide filters"
              onClick={() => { setFacetOpen(false); localStorage.setItem("ot_facet_open", "false"); }}
            >
              Hide «
            </button>
          </div>
          <FacetPanel
            facets={facetsQuery.data}
            selection={facet}
            onSelect={(sel) => {
              setFacet(sel);
              setPage(1);
            }}
          />
        </div>
      ) : (
        <button
          className="facet-rail"
          title="Show filters"
          onClick={() => { setFacetOpen(true); localStorage.setItem("ot_facet_open", "true"); }}
        >
          <span className="facet-rail-chevron">»</span>
          <span className="facet-rail-label">Filters</span>
        </button>
      ))}

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{isReports ? "Reports" : isSheets ? "Sheets" : view.label}</div>
          {!isPanel && (
            <>
              <input
                className="search"
                placeholder="Search order no, tracking…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              <select
                className="status-filter"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option value="NEW">New</option>
                <option value="FULFILLED">Fulfilled</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </>
          )}
          <div className="spacer" />
          {isAdmin && (
            <label className={`view-as ${previewing ? "active" : ""}`} title="Preview the app as another role">
              👁 View as
              <select value={previewRole} onChange={(e) => setPreviewRole(e.target.value)}>
                <option value="">Admin (me)</option>
                {PREVIEW_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </select>
            </label>
          )}
          <div className="user-box">
            {isAdmin && (
              <Link className="link-btn" to="/admin">
                Admin
              </Link>
            )}
            <span className="user-name">{user?.name}</span>
            <span className="user-role">{effectiveRole}</span>
            <button className="link-btn" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        {previewing && (
          <div className="preview-banner">
            Previewing as <b>{previewRole.replace("_", " ")}</b> — columns and editing reflect this role.
            <button onClick={() => setPreviewRole("")}>Exit preview</button>
          </div>
        )}

        {isReports ? (
          <ReportsPanel />
        ) : isSheets ? (
          <SheetsPanel />
        ) : (
          <>
            <div className="table-wrap">
              {ordersQuery.isError && (
                <div className="banner error">
                  {(ordersQuery.error as Error)?.message || "Failed to load orders"}
                </div>
              )}
              <OrdersTable
                orders={ordersQuery.data?.orders ?? []}
                loading={ordersQuery.isLoading}
                role={effectiveRole}
                dropdowns={dropdownsQuery.data?.options}
                perms={effectivePerms}
                viewKey={activeView}
                filters={columnFilters}
                setFilters={(f) => { setColumnFilters(f); setPage(1); }}
              />
            </div>

            <footer className="pager">
              <span>
                {total} orders · page {page}/{totalPages}
              </span>
              <div className="spacer" />
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
