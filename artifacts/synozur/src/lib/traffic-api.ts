/**
 * Typed fetch helpers for the /api/cms/traffic/* admin endpoints.
 * Kept separate from lib/api.ts so the dashboard page can evolve without
 * touching the large shared api object.
 */

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

async function jsonFetch<T>(input: string): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface TrafficFilters {
  from?: string;
  to?: string;
  days?: number;
  pageType?: string;
  path?: string;
  country?: string;
  device?: "desktop" | "mobile" | "tablet" | "bot";
  browser?: string;
  source?: "direct" | "organic" | "ai" | "referral" | "social" | "paid" | "internal";
  includeBots?: "true" | "false" | "only";
  limit?: number;
}

export function buildQuery(filters: TrafficFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface TrafficOverview {
  window: { from: string; to: string };
  totals: {
    pageviews: number;
    sessions: number;
    uniqueVisitors: number;
    countries: number;
    bots: number;
    humanSessions: number;
    activeSessions: number;
  };
}

export interface TrafficSeriesPoint {
  day: string;
  pageviews: number;
  sessions: number;
}

export interface TrafficSeries {
  window: { from: string; to: string };
  series: TrafficSeriesPoint[];
}

export interface TopPageRow {
  path: string;
  pageType: string | null;
  title: string | null;
  pageviews: number;
  sessions: number;
  avgTimeOnPageMs: number | null;
}

export interface SourceRow {
  source: string;
  sessions: number;
}
export interface ReferrerRow {
  host: string;
  source: string | null;
  sessions: number;
}
export interface UtmRow {
  campaign: string;
  source: string | null;
  medium: string | null;
  sessions: number;
}
export interface TrafficSources {
  bySource: SourceRow[];
  byReferrer: ReferrerRow[];
  byUtmCampaign: UtmRow[];
}

export interface DeviceRow { deviceType: string; sessions: number; }
export interface BrowserRow { browser: string; sessions: number; }
export interface OsRow { os: string; sessions: number; }
export interface TrafficDevices {
  byDevice: DeviceRow[];
  byBrowser: BrowserRow[];
  byOs: OsRow[];
}

export interface CountryRow { country: string; sessions: number; }
export interface TrafficCountries { items: CountryRow[]; }

export interface BotRow {
  botName: string;
  botCategory: string;
  sessions: number;
  pageviews: number;
}
export interface AiPlatformRow { host: string; sessions: number; }
export interface TrafficAiCrawlers {
  byBot: BotRow[];
  fromAiPlatforms: AiPlatformRow[];
}

export interface UtmBreakdownRow { value: string; sessions: number; }
export interface TrafficUtms {
  bySource: UtmBreakdownRow[];
  byMedium: UtmBreakdownRow[];
  byCampaign: UtmBreakdownRow[];
}

export interface EventNameRow {
  eventName: string;
  total: number;
  sessions: number;
}
export interface EventRecentRow {
  occurredAt: string;
  eventName: string;
  path: string;
  properties: Record<string, unknown> | null;
}
export interface TrafficEvents {
  byName: EventNameRow[];
  recent: EventRecentRow[];
}

export const trafficApi = {
  overview: (filters: TrafficFilters) =>
    jsonFetch<TrafficOverview>(apiUrl(`/cms/traffic/overview${buildQuery(filters)}`)),
  timeseries: (filters: TrafficFilters) =>
    jsonFetch<TrafficSeries>(apiUrl(`/cms/traffic/timeseries${buildQuery(filters)}`)),
  pages: (filters: TrafficFilters) =>
    jsonFetch<{ items: TopPageRow[] }>(apiUrl(`/cms/traffic/pages${buildQuery(filters)}`)),
  sources: (filters: TrafficFilters) =>
    jsonFetch<TrafficSources>(apiUrl(`/cms/traffic/sources${buildQuery(filters)}`)),
  devices: (filters: TrafficFilters) =>
    jsonFetch<TrafficDevices>(apiUrl(`/cms/traffic/devices${buildQuery(filters)}`)),
  countries: (filters: TrafficFilters) =>
    jsonFetch<TrafficCountries>(apiUrl(`/cms/traffic/countries${buildQuery(filters)}`)),
  aiCrawlers: (filters: TrafficFilters) =>
    jsonFetch<TrafficAiCrawlers>(apiUrl(`/cms/traffic/ai-crawlers${buildQuery(filters)}`)),
  utms: (filters: TrafficFilters) =>
    jsonFetch<TrafficUtms>(apiUrl(`/cms/traffic/utms${buildQuery(filters)}`)),
  events: (filters: TrafficFilters) =>
    jsonFetch<TrafficEvents>(apiUrl(`/cms/traffic/events${buildQuery(filters)}`)),
  exportCsvUrl: (filters: TrafficFilters) =>
    apiUrl(`/cms/traffic/export.csv${buildQuery(filters)}`),
  overviewCsvUrl: (filters: TrafficFilters) =>
    apiUrl(`/cms/analytics/overview.csv${buildQuery(filters)}`),
  sessionsCsvUrl: (filters: TrafficFilters) =>
    apiUrl(`/cms/analytics/sessions.csv${buildQuery(filters)}`),
};
