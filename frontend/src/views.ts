// Sidebar views. Each maps to backend query params. Mirrors the AppSheet slices.
// `store` views filter by a single store; `view` views use the server-side named slice.

export interface ViewDef {
  key: string;
  label: string;
  params: { view?: string; store?: string; status?: string };
  group: "all" | "stores" | "production" | "status" | "deadline";
}

// Store labels reflect the names shown in the current AppSheet sidebar.
// (The time in each label is the store's local cutoff — confirm/adjust as needed.)
export const STORE_VIEWS: ViewDef[] = [
  { key: "s-cheetah", label: "Cheetah DTF", store: "CHEETAH" },
  { key: "s-picasso", label: "Picasso DTF", store: "PICASSO" },
  { key: "s-gangroll", label: "Gangroll DTF", store: "GANGROLL" },
  { key: "s-indiana", label: "Indiana DTF", store: "INDIANA" },
  { key: "s-bostonian", label: "Bostonian DTF", store: "BOSTONIAN" },
  { key: "s-musiccity", label: "Music City DTF", store: "MUSICCITY" },
  { key: "s-westcoast", label: "DTF West Coast", store: "WESTCOAST" },
  { key: "s-missouri", label: "Missouri DTF", store: "MISSOURI" },
  { key: "s-luisville", label: "Louisville DTF", store: "LUISVILLE" },
  { key: "s-promo", label: "DTF Promo", store: "PROMO" },
].map((s) => ({ key: s.key, label: s.label, params: { store: s.store }, group: "stores" as const }));

export const VIEWS: ViewDef[] = [
  { key: "all", label: "All Orders", params: {}, group: "all" },
  ...STORE_VIEWS,
  // Production routing
  { key: "fortworth", label: "Fort Worth / Cheetah Production", params: { view: "fortworth" }, group: "production" },
  { key: "richardson", label: "Richardson Production", params: { view: "richardson" }, group: "production" },
  { key: "houston", label: "Houston Production", params: { view: "houston" }, group: "production" },
  { key: "mesquite", label: "Mesquite Production", params: { view: "mesquite" }, group: "production" },
  { key: "outsidepickup", label: "Outside Pick-up", params: { view: "outsidepickup" }, group: "production" },
  // Deadline
  { key: "deadline5", label: "Today 5 PM", params: { view: "deadline5" }, group: "deadline" },
  // Status
  { key: "problem", label: "Problem", params: { view: "problemli" }, group: "status" },
  { key: "notprinted", label: "Not Printed", params: { view: "notprinted" }, group: "status" },
];

export const GROUP_LABELS: Record<ViewDef["group"], string> = {
  all: "",
  stores: "Stores",
  production: "Production",
  deadline: "Deadline",
  status: "Status",
};
