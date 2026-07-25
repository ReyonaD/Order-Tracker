// Single source of truth for column keys + English labels + which are editable.
// Used by the orders table and the admin permission matrix.
export interface ColMeta {
  key: string;
  label: string;
  editable: boolean;
  alwaysVisible?: boolean; // orderName is pinned and cannot be hidden
}

export const COLUMN_META: ColMeta[] = [
  { key: "orderName", label: "Order No", editable: false, alwaysVisible: true },
  { key: "urgent", label: "Urgent", editable: true },
  { key: "store", label: "Store", editable: false },
  { key: "shipping", label: "Pickup/Ship", editable: false },
  { key: "date", label: "Date", editable: false },
  { key: "deadline", label: "Deadline", editable: false },
  { key: "item", label: "Item", editable: false },
  { key: "price", label: "Price", editable: false },
  { key: "designer", label: "Designer", editable: true },
  { key: "upload", label: "Uploaded", editable: true },
  { key: "file", label: "File", editable: true },
  { key: "image", label: "Image", editable: true },
  { key: "print", label: "Print", editable: true },
  { key: "machinist", label: "Operator", editable: true },
  { key: "machine", label: "Machine", editable: true },
  { key: "note", label: "Note", editable: true },
  { key: "order", label: "Order", editable: false },
  { key: "tracking", label: "Tracking", editable: false },
  { key: "status", label: "Status", editable: true },
];

export const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  COLUMN_META.map((c) => [c.key, c.label])
);

// Columns that appear in the permission matrix (orderName always visible → excluded).
export const PERMISSION_COLUMNS = COLUMN_META.filter((c) => !c.alwaysVisible).map((c) => c.key);
