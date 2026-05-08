/**
 * Client-side A/B experiments runtime.
 *
 * - `ExperimentsProvider` loads running experiments and computes the
 *   visitor's assigned variant deterministically from
 *   hash(visitorId + ":" + experimentKey).
 * - `useOverride(key, fallback)` looks up an override on the active
 *   variant for any experiment whose pageKey matches the current page.
 *   Misses fall back to the supplied default — so removing an
 *   experiment cleanly reverts to today's content.
 * - `trackConversion(eventId, extras)` fires a traffic event with the
 *   active experiment/variant context attached, so reporting can
 *   compute conversion rates per variant.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { getVisitorId } from "@/lib/visitor-id";
import { trackEvent } from "@/lib/traffic-tracker";

export interface ExperimentVariantPublic {
  key: string;
  name: string;
  isControl: boolean;
  weight: number;
  overrides: Record<string, unknown>;
}

export interface ExperimentPublic {
  key: string;
  pageKey: string;
  trafficPercentage: number;
  conversionPaths: Array<{
    kind: "cta" | "booking" | "path";
    value: string;
    label: string;
  }>;
  variants: ExperimentVariantPublic[];
}

export interface ActiveAssignment {
  experiment: ExperimentPublic;
  variant: ExperimentVariantPublic;
  // null = natural assignment; "url" / "admin_preview" = forced.
  forcedBy: null | "url" | "admin_preview";
}

interface ExperimentsContextValue {
  isReady: boolean;
  // Map of experimentKey → assignment (only experiments where the
  // visitor was bucketed in-test).
  assignments: Map<string, ActiveAssignment>;
  // All running experiments (regardless of in/out-of-test). Used by
  // the route-conversion tracker to know which paths to watch.
  allExperiments: ExperimentPublic[];
}

const ExperimentsContext = createContext<ExperimentsContextValue>({
  isReady: false,
  assignments: new Map(),
  allExperiments: [],
});

// ---------- Bucketing ---------------------------------------------------
//
// cyrb53 — small synchronous string hash with a 53-bit output. Good
// enough distribution for A/B bucketing (we only need uniformity over
// 100 buckets) and fits in this file without pulling in a dependency.
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function pickVariant(
  visitorId: string,
  experiment: ExperimentPublic,
): ExperimentVariantPublic | null {
  if (experiment.variants.length === 0) return null;
  const bucket = cyrb53(`${visitorId}:${experiment.key}`) % 100;
  // Visitors past the trafficPercentage cutoff are "out of test" — no
  // assignment is recorded and useOverride falls through to the
  // component's default fallback so they don't pollute reporting as
  // pseudo-control. The page renders the same default content control
  // is meant to mirror.
  if (bucket >= experiment.trafficPercentage) return null;
  // Weighted pick within the [0, trafficPercentage) range.
  const inTestBucket = (bucket * 100) / experiment.trafficPercentage;
  // Sort variants by key for stable ordering across deploys.
  const sorted = [...experiment.variants].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  let cum = 0;
  for (const v of sorted) {
    cum += v.weight;
    if (inTestBucket < cum) return v;
  }
  // Weights are validated to sum to 100 server-side at start; a
  // misconfigured experiment falls through to control rather than no-op.
  return experiment.variants.find((v) => v.isControl) ?? null;
}

// ---------- URL force overrides ----------------------------------------
//
// `?_exp=experimentKey:variantKey` forces a specific variant for QA.
// Persists in sessionStorage for the tab so a reload without the param
// still shows the chosen variant. Cleared with `?_exp=clear`.

const FORCE_STORAGE_KEY = "syn_force_exp";

interface ForcedAssignment {
  experimentKey: string;
  variantKey: string;
}

function readForcedFromStorage(): ForcedAssignment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(FORCE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ForcedAssignment[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        typeof p === "object" &&
        typeof p.experimentKey === "string" &&
        typeof p.variantKey === "string",
    );
  } catch {
    return [];
  }
}

function writeForcedToStorage(list: ForcedAssignment[]): void {
  if (typeof window === "undefined") return;
  try {
    if (list.length === 0) {
      window.sessionStorage.removeItem(FORCE_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(FORCE_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // ignore
  }
}

// Read the current ?_exp= value and update the forced map. Idempotent.
// Returns the new forced list so callers can apply it immediately.
function syncForcedFromUrl(): ForcedAssignment[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("_exp");
  if (raw === null) return readForcedFromStorage();
  if (raw === "clear" || raw === "") {
    writeForcedToStorage([]);
    return [];
  }
  // Format: experimentKey:variantKey, comma-separated for multiple.
  const next: ForcedAssignment[] = [];
  for (const pair of raw.split(",")) {
    const [experimentKey, variantKey] = pair.split(":");
    if (experimentKey && variantKey) {
      next.push({ experimentKey, variantKey });
    }
  }
  // Merge with any existing forced entries for OTHER experiments so the
  // QA can preview multiple experiments via successive URL clicks.
  const existing = readForcedFromStorage();
  const overriddenKeys = new Set(next.map((n) => n.experimentKey));
  const merged = [
    ...existing.filter((e) => !overriddenKeys.has(e.experimentKey)),
    ...next,
  ];
  writeForcedToStorage(merged);
  return merged;
}

// ---------- Provider ----------------------------------------------------

export function ExperimentsProvider({ children }: { children: ReactNode }) {
  const { data, isFetched } = useQuery({
    queryKey: ["public-experiments-active"],
    queryFn: () => api.getActiveExperiments(),
    // Mirror site-settings: short stale time. The server adds its own
    // SWR-friendly Cache-Control header.
    staleTime: 60_000,
    retry: false,
  });

  const allExperiments: ExperimentPublic[] = useMemo(
    () => (data?.experiments ?? []) as ExperimentPublic[],
    [data],
  );

  // Compute assignments once we have data. Recomputed on data change
  // (e.g. admin starts a new experiment in another tab) — visitor ID
  // is stable so the assignment for any given experiment is also stable.
  const assignments = useMemo(() => {
    if (!isFetched) return new Map<string, ActiveAssignment>();
    const map = new Map<string, ActiveAssignment>();
    if (allExperiments.length === 0) return map;
    const visitorId = getVisitorId();
    const forced = syncForcedFromUrl();
    const forcedByKey = new Map(
      forced.map((f) => [f.experimentKey, f.variantKey]),
    );
    for (const exp of allExperiments) {
      const forcedVariantKey = forcedByKey.get(exp.key);
      if (forcedVariantKey) {
        const variant =
          exp.variants.find((v) => v.key === forcedVariantKey) ?? null;
        if (variant) {
          map.set(exp.key, {
            experiment: exp,
            variant,
            forcedBy: "url",
          });
          continue;
        }
      }
      const variant = pickVariant(visitorId, exp);
      if (!variant) continue;
      map.set(exp.key, { experiment: exp, variant, forcedBy: null });
    }
    return map;
  }, [isFetched, allExperiments]);

  // Fire-and-forget: persist assignment server-side and fire a
  // variant_assignment traffic event once per (visitor, experiment).
  const reportedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isFetched) return;
    if (typeof window === "undefined") return;
    for (const [expKey, a] of assignments.entries()) {
      const dedupKey = `${expKey}:${a.variant.key}:${a.forcedBy ?? "natural"}`;
      if (reportedRef.current.has(dedupKey)) continue;
      reportedRef.current.add(dedupKey);
      // Persist the assignment row. Idempotent server-side.
      void api.postExperimentAssignment({
        experimentKey: expKey,
        variantKey: a.variant.key,
        visitorId: getVisitorId(),
        forcedBy: a.forcedBy,
      });
      // Fire variant_assignment event once per (visitor, experiment) per
      // tab session — the local guard avoids duplicate events from
      // strict-mode double-mounts and rapid query refetches.
      const sessionGuardKey = `syn_assigned_${expKey}_${a.variant.key}`;
      try {
        if (window.sessionStorage.getItem(sessionGuardKey)) continue;
        window.sessionStorage.setItem(sessionGuardKey, "1");
      } catch {
        // ignore — duplicate variant_assignment events are filtered in
        // reporting via DISTINCT visitor_id, so this is non-fatal.
      }
      void trackEvent("variant_assignment", {
        experiment_key: expKey,
        variant_key: a.variant.key,
        is_control: a.variant.isControl,
        forced_by: a.forcedBy,
      });
    }
  }, [isFetched, assignments]);

  const value: ExperimentsContextValue = {
    isReady: isFetched,
    assignments,
    allExperiments,
  };
  return (
    <ExperimentsContext.Provider value={value}>
      {children}
    </ExperimentsContext.Provider>
  );
}

export function useExperimentsContext(): ExperimentsContextValue {
  return useContext(ExperimentsContext);
}

// ---------- Page-aware override lookup ---------------------------------

// Map a page namespace prefix from an override key to the experiment's
// pageKey. e.g. "home.hero.cta.visible" → "home"; "header.cta.visible"
// → null (header overrides apply on every page).
function pageScopeForKey(key: string): string | null {
  if (key.startsWith("header.")) return null;
  const dot = key.indexOf(".");
  if (dot === -1) return null;
  return key.slice(0, dot);
}

// Look up the override on whatever experiment is active for the
// matching page. If the key namespace is `header.`, we honor any
// running experiment that defines the key (header overrides are
// site-wide); otherwise the key's namespace must match the
// experiment's pageKey.
export function useOverride<T>(key: string, fallback: T): T {
  const { assignments } = useExperimentsContext();
  const scope = pageScopeForKey(key);
  for (const a of assignments.values()) {
    if (scope !== null && a.experiment.pageKey !== scope) continue;
    if (key in a.variant.overrides) {
      const value = a.variant.overrides[key];
      if (value !== undefined) return value as T;
    }
  }
  return fallback;
}

// Returns the current assignment (if any) for a specific experiment.
// Useful for diagnostics; component overrides should prefer useOverride.
export function useVariant(experimentKey: string): ActiveAssignment | null {
  const { assignments } = useExperimentsContext();
  return assignments.get(experimentKey) ?? null;
}

// ---------- Conversion tracking ----------------------------------------

// Returns the experiment context to attach to events. We fold every
// running experiment the visitor is assigned to into the event so a
// single click can be attributed across overlapping experiments
// (rare, but possible if two pages overlap a CTA).
function attachExperimentContext(
  base: Record<string, unknown>,
  assignments: Map<string, ActiveAssignment>,
): Record<string, unknown> {
  if (assignments.size === 0) return { ...base, visitor_id: getVisitorId() };
  // Single-experiment shortcut so the common case is flat & easy to
  // query in SQL.
  if (assignments.size === 1) {
    const [expKey, a] = assignments.entries().next().value!;
    return {
      ...base,
      visitor_id: getVisitorId(),
      experiment_key: expKey,
      variant_key: a.variant.key,
      is_control: a.variant.isControl,
    };
  }
  // Multiple experiments: include both the array form and a primary
  // pair (the first experiment, lexicographically) for SQL convenience.
  const entries = [...assignments.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const [primaryKey, primary] = entries[0]!;
  return {
    ...base,
    visitor_id: getVisitorId(),
    experiment_key: primaryKey,
    variant_key: primary.variant.key,
    is_control: primary.variant.isControl,
    experiments: entries.map(([k, a]) => ({
      experiment_key: k,
      variant_key: a.variant.key,
      is_control: a.variant.isControl,
    })),
  };
}

// Hook flavor — needs the context. Component code should use this.
export function useTrackConversion() {
  const { assignments } = useExperimentsContext();
  return (eventId: string, extras: Record<string, unknown> = {}) => {
    void trackEvent(eventId, attachExperimentContext(extras, assignments));
  };
}

// ---------- Path-based conversion tracker ------------------------------

// Mounted near the router. Watches location changes and, for each
// running experiment with `path`-kind conversions, fires a
// `conversion.path.visit` event when the location starts with a
// configured path. Dedupes per (visitor, experiment, path) for the tab
// session.
export function useRouteConversionTracker(): void {
  const [location] = useLocation();
  const { assignments, isReady } = useExperimentsContext();
  const reportedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isReady) return;
    if (assignments.size === 0) return;
    for (const [expKey, a] of assignments.entries()) {
      for (const cp of a.experiment.conversionPaths) {
        if (cp.kind !== "path") continue;
        if (!location.startsWith(cp.value)) continue;
        const dedupKey = `${expKey}:${cp.value}`;
        if (reportedRef.current.has(dedupKey)) continue;
        reportedRef.current.add(dedupKey);
        void trackEvent(
          "conversion.path.visit",
          attachExperimentContext(
            {
              path: cp.value,
              label: cp.label,
              location,
            },
            assignments,
          ),
        );
      }
    }
  }, [location, isReady, assignments]);
}
