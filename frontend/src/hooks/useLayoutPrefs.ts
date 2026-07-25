import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface Layout {
  order: string[]; // reorderable column keys, in display order
  widths: Record<string, number>;
  visible: string[]; // visible column keys
}
export interface Preset extends Layout {
  name: string;
}
interface Prefs {
  layouts?: Record<string, Layout>; // per-view layouts (keyed by view key)
  base?: Layout; // fallback template for views without their own layout
  layout?: Layout; // legacy single layout (migrated to `base`)
  presets?: Preset[];
}

// Reconcile a saved order with the current set of columns (tolerates added/removed cols).
function mergeOrder(saved: string[] | undefined, all: string[]): string[] {
  const s = saved ?? [];
  const known = s.filter((k) => all.includes(k));
  const missing = all.filter((k) => !known.includes(k));
  return [...known, ...missing];
}

function normalize(l: Layout, defaults: Layout): Layout {
  return {
    order: mergeOrder(l.order, defaults.order),
    widths: l.widths ?? {},
    visible: l.visible ?? defaults.visible,
  };
}

/**
 * Per-account, per-VIEW column layout + shared presets, persisted server-side.
 * Each view (All Orders, Outside Pick-up, …) keeps its own column configuration.
 */
export function useLayoutPrefs(defaults: Layout, viewKey: string) {
  const { data, isSuccess } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.get<{ preferences: Prefs | null }>("/auth/preferences"),
    staleTime: Infinity,
  });

  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [baseLayout, setBaseLayout] = useState<Layout | null>(null); // legacy fallback
  const [presets, setPresets] = useState<Preset[]>([]);
  const hydrated = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Hydrate from the server exactly once.
  useEffect(() => {
    if (!isSuccess || hydrated.current) return;
    const p = data?.preferences;
    if (p) {
      if (p.layouts) setLayouts(p.layouts);
      // Fallback template: explicit `base`, else the legacy single `layout`.
      if (p.base) setBaseLayout(p.base);
      else if (p.layout) setBaseLayout(p.layout);
      if (Array.isArray(p.presets)) setPresets(p.presets);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  // Debounced persist after any change.
  useEffect(() => {
    if (!hydrated.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const preferences: Prefs = { layouts, presets };
      if (baseLayout) preferences.base = baseLayout; // keep the fallback template
      api.put("/auth/preferences", { preferences }).catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer.current);
  }, [layouts, presets]);

  // Layout for the CURRENT view: saved view layout → legacy fallback → defaults.
  const layout = normalize(layouts[viewKey] ?? baseLayout ?? defaults, defaults);

  const setLayout = (updater: Layout | ((prev: Layout) => Layout)) =>
    setLayouts((prev) => {
      const cur = normalize(prev[viewKey] ?? baseLayout ?? defaults, defaults);
      const next = typeof updater === "function" ? (updater as (p: Layout) => Layout)(cur) : updater;
      return { ...prev, [viewKey]: next };
    });

  return { layout, setLayout, presets, setPresets, ready: isSuccess };
}
