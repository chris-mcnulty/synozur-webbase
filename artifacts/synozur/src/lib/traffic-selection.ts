/**
 * Pure selection + merge model for the cross-property traffic report.
 * Orion is a synthetic, read-through property: never queried from local
 * storage and never summed into local measures.
 */
export const DEFAULT_SLUG = "synozur";
export const ORION_SLUG = "orion";
export const ALL_SLUG = "all";

export function parseSelection(raw: string | null | undefined): string[] {
  if (!raw) return [DEFAULT_SLUG];
  const parts = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (parts.length === 0) return [DEFAULT_SLUG];
  if (parts.includes(ALL_SLUG)) return [ALL_SLUG];
  return parts;
}

/** null means "default" (omit the URL param). */
export function serializeSelection(sel: string[]): string | null {
  if (sel.length === 1 && sel[0] === DEFAULT_SLUG) return null;
  return sel.join(",");
}

export function toggleSelection(prev: string[], slug: string): string[] {
  if (slug === ALL_SLUG) return [ALL_SLUG];
  const without = prev.filter((s) => s !== ALL_SLUG);
  if (without.includes(slug)) {
    const next = without.filter((s) => s !== slug);
    return next.length === 0 ? [DEFAULT_SLUG] : next;
  }
  return [...without, slug];
}

export interface ResolvedSelection {
  isAll: boolean;
  includeOrion: boolean;
  /** Explicit local slugs, never containing orion or the "all" sentinel. */
  localSlugs: string[];
  mode: "local" | "orion" | "mixed";
}

export function resolveSelection(sel: string[], knownLocalSlugs: string[]): ResolvedSelection {
  const isAll = sel.includes(ALL_SLUG);
  const known = knownLocalSlugs.filter((s) => s !== ORION_SLUG && s !== ALL_SLUG);
  const includeOrion = isAll || sel.includes(ORION_SLUG);
  const localSlugs = isAll ? known : sel.filter((s) => s !== ORION_SLUG && s !== ALL_SLUG);
  const mode = includeOrion ? (localSlugs.length ? "mixed" : "orion") : "local";
  return { isAll, includeOrion, localSlugs, mode };
}

export interface DimRow { key: string; local: number | null; orion: number | null }

/**
 * Merge a dimension. A `null` source means not selected or unavailable:
 * its column stays null (never zero-filled). Units stay separate.
 */
export function mergeDimension(
  local: { key: string; count: number }[] | null,
  orion: { key: string; count: number }[] | null,
): DimRow[] {
  const m = new Map<string, DimRow>();
  const norm = (k: string) => k || "unknown";
  for (const r of local ?? []) {
    const k = norm(r.key);
    const row = m.get(k) ?? { key: k, local: 0, orion: orion ? 0 : null };
    row.local = (row.local ?? 0) + r.count;
    m.set(k, row);
  }
  for (const r of orion ?? []) {
    const k = norm(r.key);
    const row = m.get(k) ?? { key: k, local: local ? 0 : null, orion: 0 };
    row.orion = (row.orion ?? 0) + r.count;
    m.set(k, row);
  }
  if (!local) for (const r of m.values()) r.local = null;
  if (!orion) for (const r of m.values()) r.orion = null;
  return [...m.values()].sort((a, b) => (b.local ?? 0) + (b.orion ?? 0) - ((a.local ?? 0) + (a.orion ?? 0)));
}

export interface DailyRow {
  date: string;
  localPageviews?: number;
  localSessions?: number;
  orionVisits?: number;
}

/** Shared daily trend restricted to the explicit [from, to] UTC window. */
export function mergeDaily(
  local: { day: string; pageviews: number; sessions: number }[] | null,
  orion: { date: string; count: number }[] | null,
  window: { from: string; to: string },
): DailyRow[] {
  const lo = window.from.slice(0, 10);
  const hi = window.to.slice(0, 10);
  const m = new Map<string, DailyRow>();
  const get = (d: string) => {
    const row = m.get(d) ?? {
      date: d,
      ...(local ? { localPageviews: 0, localSessions: 0 } : {}),
      ...(orion ? { orionVisits: 0 } : {}),
    };
    m.set(d, row);
    return row;
  };
  for (const r of local ?? []) {
    const d = r.day.slice(0, 10);
    if (d < lo || d > hi) continue;
    const row = get(d);
    row.localPageviews = (row.localPageviews ?? 0) + r.pageviews;
    row.localSessions = (row.localSessions ?? 0) + r.sessions;
  }
  for (const r of orion ?? []) {
    const d = r.date.slice(0, 10);
    if (d < lo || d > hi) continue;
    const row = get(d);
    row.orionVisits = (row.orionVisits ?? 0) + r.count;
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Snapshots are authoritative: a newer snapshot replaces, never adds. */
export function applySnapshot<T>(_prev: T | undefined, next: T): T {
  return next;
}

/** Calendar-year UTC window; the current year ends at the end of today (UTC). */
export function annualWindow(year: number, now: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(year, 0, 1));
  const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59, 999);
  const todayEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);
  return { from: from.toISOString(), to: new Date(Math.min(yearEnd, todayEnd)).toISOString() };
}

/**
 * Approved marketing definition: Sessions = local sessions + Orion recorded
 * visits, counted once. Returns partial=true when Orion was required but
 * unavailable, so callers never present the local part as complete.
 */
export function combineSessions(
  localSessions: number | null,
  orionVisits: number | null,
  includeOrion: boolean,
  hasLocal: boolean,
): { value: number | null; partial: boolean } {
  const localOk = !hasLocal || localSessions !== null;
  const orionOk = !includeOrion || orionVisits !== null;
  const hasReportedSource = (hasLocal && localSessions !== null) || (includeOrion && orionVisits !== null);
  if (!hasReportedSource) return { value: null, partial: true };
  const value = (hasLocal ? localSessions ?? 0 : 0) + (includeOrion ? orionVisits ?? 0 : 0);
  return { value, partial: !localOk || !orionOk };
}

export function withCombinedSessions(rows: DailyRow[]): (DailyRow & { sessions?: number })[] {
  return rows.map((r) => ({
    ...r,
    sessions: r.localSessions === undefined && r.orionVisits === undefined
      ? undefined
      : (r.localSessions ?? 0) + (r.orionVisits ?? 0),
  }));
}
