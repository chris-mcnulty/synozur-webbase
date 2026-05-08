/**
 * Pure-logic helpers extracted from `lib/experiments.tsx` so the
 * bucketing math, URL force-override parsing, and override key
 * resolution can be unit-tested without React/wouter/react-query
 * imports. Keep this module dependency-free.
 */

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
  holdbackPercentage?: number;
  conversionPaths: Array<{
    kind: "cta" | "booking" | "path";
    value: string;
    label: string;
  }>;
  variants: ExperimentVariantPublic[];
}

export const HOLDBACK_VARIANT_KEY = "_holdback";

export const HOLDBACK_VARIANT: ExperimentVariantPublic = {
  key: HOLDBACK_VARIANT_KEY,
  name: "Holdback",
  isControl: false,
  weight: 0,
  overrides: {},
};

// cyrb53 — small synchronous string hash with a 53-bit output. Good
// enough distribution for A/B bucketing (we only need uniformity over
// 100 buckets) and fits in this module without pulling in a dependency.
export function cyrb53(str: string, seed = 0): number {
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

export function pickVariant(
  visitorId: string,
  experiment: ExperimentPublic,
): ExperimentVariantPublic | null {
  if (experiment.variants.length === 0) return null;
  const bucket = cyrb53(`${visitorId}:${experiment.key}`) % 100;
  if (bucket >= experiment.trafficPercentage) return null;
  const inTestBucket = (bucket * 100) / experiment.trafficPercentage;
  const holdback = experiment.holdbackPercentage ?? 0;
  if (holdback > 0 && inTestBucket < holdback) return HOLDBACK_VARIANT;
  const variantBucket =
    holdback > 0
      ? ((inTestBucket - holdback) * 100) / (100 - holdback)
      : inTestBucket;
  const sorted = [...experiment.variants].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  let cum = 0;
  for (const v of sorted) {
    cum += v.weight;
    if (variantBucket < cum) return v;
  }
  return experiment.variants.find((v) => v.isControl) ?? null;
}

// Map "home.hero.cta.visible" → "home". Header overrides are
// site-wide and return null so they apply on every page.
export function pageScopeForKey(key: string): string | null {
  if (key.startsWith("header.")) return null;
  const dot = key.indexOf(".");
  if (dot === -1) return null;
  return key.slice(0, dot);
}

// Convention map: pageKey → URL routes that count as "the
// experiment's page" for assignment-recording and admin preview
// purposes. Update both halves when adding new override-instrumented
// pages. An "*" entry means "any path" (used by site-wide pageKeys
// like "header").
const PAGE_KEY_PATHS: Record<string, string[] | "*"> = {
  home: ["/"],
  services: ["/services-overview", "/services"],
  applications: ["/applications"],
  "case-studies": ["/case-studies"],
  header: "*",
};

// Whether the given location is "on" the experiment's targeted page
// per the conventions above. Falls back to a permissive prefix check
// (`/<pageKey>`) for unknown pageKeys so admins can introduce new
// scopes without first updating this map.
export function pageKeyMatchesLocation(
  pageKey: string,
  location: string,
): boolean {
  const entry = PAGE_KEY_PATHS[pageKey];
  if (entry === "*") return true;
  if (entry) {
    return entry.some((p) =>
      p === "/" ? location === "/" || location === "" : location.startsWith(p),
    );
  }
  // Unknown pageKey — heuristic: location starts with "/<pageKey>".
  return location === `/${pageKey}` || location.startsWith(`/${pageKey}/`);
}

// Suggested URL to open when previewing a forced variant for an
// experiment with the given pageKey.
export function previewPathForPageKey(pageKey: string): string {
  const entry = PAGE_KEY_PATHS[pageKey];
  if (Array.isArray(entry)) return entry[0]!;
  if (entry === "*") return "/";
  return `/${pageKey}`;
}

export interface ForcedAssignment {
  experimentKey: string;
  variantKey: string;
}

// Parse the `_exp` query param. Returns the new effective forced list
// when `_exp` is present in the URL, merged with the existing list
// for OTHER experiments so QA can preview multiple experiments via
// successive URL clicks. `_exp=clear` empties the list. Returns
// `null` when `_exp` is absent (caller should keep prior storage).
export function parseForcedFromQuery(
  query: string,
  existing: ForcedAssignment[],
): ForcedAssignment[] | null {
  const params = new URLSearchParams(query);
  const raw = params.get("_exp");
  if (raw === null) return null;
  if (raw === "clear" || raw === "") return [];
  const next: ForcedAssignment[] = [];
  for (const pair of raw.split(",")) {
    const [experimentKey, variantKey] = pair.split(":");
    if (experimentKey && variantKey) {
      next.push({ experimentKey, variantKey });
    }
  }
  const overriddenKeys = new Set(next.map((n) => n.experimentKey));
  return [
    ...existing.filter((e) => !overriddenKeys.has(e.experimentKey)),
    ...next,
  ];
}
