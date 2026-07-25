export type Role = "ADMIN" | "DESIGNER" | "MACHINIST" | "CUSTOMER_SERVICE" | "VIEWER";
export type OrderStatus = "NEW" | "FULFILLED" | "CANCELLED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  canViewReports?: boolean;
  canViewSheets?: boolean;
}

export interface StoreRef {
  code: string;
  name: string;
  color: string;
}

export interface Order {
  id: string;
  shopifyOrderId: string;
  orderName: string;
  storeCode: string;
  store?: StoreRef;
  shippingMethod: string;
  displayShippingMethod: string;
  isPickup: boolean;
  totalPrice: number | null;
  orderDate: string;
  deadlineAt: string;
  deadlineHour: number;
  urgent: boolean;
  itemTypes: string[];
  lineItems?: Array<{ name?: string; title?: string; variant_title?: string; sku?: string; quantity?: number; price?: string }> | null;
  orderUrl: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: OrderStatus;
  // workflow (G–M)
  designerName: string | null;
  uploadStatus: string | null;
  problemEmailSent: boolean;
  fileLink: string | null;
  printStatus: string | null;
  designerNote: string | null;
  machinistName: string | null;
  machineName: string | null;
  image?: { id: string; filename: string; mimeType: string; updatedAt: string } | null;
}

export interface OrdersResponse {
  status: string;
  total: number;
  page: number;
  pageSize: number;
  orders: Order[];
}

export interface Store {
  id: string;
  code: string;
  name: string;
  color: string;
  shopifyIdentifier: string;
  timezone: string;
  pickupCutoffHour: number;
  shippingCutoffHour: number;
  hasSecret?: boolean;
}

export type DropdownCategory =
  | "designer"
  | "machinist"
  | "machine"
  | "uploadStatus"
  | "printStatus";

export type Dropdowns = Record<DropdownCategory, string[]>;

export interface DropdownOption {
  id: string;
  category: DropdownCategory;
  value: string;
  sort: number;
  active: boolean;
}

export interface ColPerm { view: boolean; edit: boolean }
export type RolePerms = Record<string, ColPerm>;
export type PermissionsMatrix = Record<string, RolePerms>; // role -> column -> perm

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  canViewReports: boolean;
  canViewSheets: boolean;
  createdAt: string;
}

// Sheets (monthly account tracking)
export interface SheetCategoryDef { key: string; label: string; kind: "inches" | "count"; split: boolean }
export interface SheetCell { auto: number; splitPct: Record<string, number> | null; totalOverride: number | null; baseline?: number | null }
export interface SheetRow { code: string; name: string; cells: Record<string, SheetCell> }
export interface SheetsResponse {
  status: string; month: string; from: string; to: string; editable: boolean;
  warehouses: string[]; splitWarehouses: string[];
  allWarehouses: string[]; allSplitWarehouses: string[];
  categories: SheetCategoryDef[]; rows: SheetRow[];
}

// Reports
export interface ReportGroup { key: string; count: number; revenue: number; units: number; inches: number }
export interface ReportCell { r: string; c: string; count: number; revenue: number; units: number; inches: number }
export interface ReportTotals { count: number; revenue: number; units: number; inches: number }
export interface ReportSeriesPoint { bucket: string; count: number; revenue: number; units: number; inches: number }
export interface ReportResponse {
  status: string;
  meta: {
    from: string; to: string; stores: string[];
    fulfillment: string; groupBy: string; groupBy2: string | null;
    includeCancelled: boolean; overlaps: boolean;
  };
  totals: ReportTotals;
  groups?: ReportGroup[];
  cells?: ReportCell[];
  series?: ReportSeriesPoint[];
  seriesBucket?: "hour" | "day";
  hasBaseline?: boolean;
  baseline?: { inches: number; units: number };
}

export interface FacetGroup {
  key: string; // store code, or "Pickup"/"Shipping"
  count: number;
}
export interface DayFacet {
  day: string; // "YYYY-MM-DD"
  total: number;
  groups: FacetGroup[];
}
export interface MonthFacet {
  month: string; // "YYYY-MM"
  total: number;
  days: DayFacet[];
}
export interface FacetsResponse {
  status: string;
  total: number;
  by: "store" | "pickup";
  months: MonthFacet[];
}

// An ad-hoc column filter (the "Filters" popover).
export interface FilterCond {
  col: string;
  op: "is" | "isnot" | "contains";
  value: string;
}

// A facet drill-down selection.
export interface FacetSelection {
  month: string;
  day: string;
  store: string;
  pickup: string; // "", "true", "false"
}
