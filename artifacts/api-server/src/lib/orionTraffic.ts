import { z } from "zod";

const count = z.number().int().nonnegative();
const dateCount = z.object({ date: z.string(), count });
const event = z.object({ event: z.string(), source: z.string(), count });

// The portal returns aggregates, not sessions or unique people. Do not derive
// those metrics from visit counts or sum legacy aliases with activity.byEvent.
export const orionTrafficSchema = z.object({
  reportingVersion: z.number().int().min(2),
  totalVisits: count,
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  bySection: z.array(z.object({ section: z.string(), count })),
  byPage: z.array(z.object({ page: z.string(), count })),
  byDate: z.array(dateCount),
  byCountry: z.array(z.object({ country: z.string(), count })),
  byDevice: z.array(z.object({ device: z.string(), count })),
  byBrowser: z.array(z.object({ browser: z.string(), count })),
  activity: z.object({
    totalEvents: count,
    byEvent: z.array(event),
    byResource: z.array(z.object({
      resourceType: z.string(),
      resourceId: z.string(),
      resourceName: z.string(),
      count,
      byEvent: z.record(z.string(), count),
    })),
    timeSeries: z.array(dateCount),
    notes: z.array(z.string()),
  }),
});

export type OrionTrafficData = z.infer<typeof orionTrafficSchema>;
export interface OrionTrafficReport {
  data: OrionTrafficData;
  fetchedAt: string;
  stale: boolean;
  refreshError?: string;
}

export function parseOrionTraffic(raw: unknown): OrionTrafficData {
  const envelope = z.object({ data: orionTrafficSchema }).parse(raw);
  return envelope.data;
}

// Read-through snapshots: no ingestion, increments, synthesized pageviews or
// cumulative additions. Repeated reads cannot inflate any traffic table.
export function createOrionTrafficReader(
  fetchReport: (from: string, to: string) => Promise<unknown>,
  now = () => Date.now(),
) {
  const snapshots = new Map<string, OrionTrafficReport>();
  const pending = new Map<string, Promise<OrionTrafficReport>>();
  const ttl = 5 * 60_000;
  return async (from: string, to: string, refresh = false): Promise<OrionTrafficReport> => {
    const key = `${from}:${to}`;
    const cached = snapshots.get(key);
    if (!refresh && cached && !cached.stale && now() - Date.parse(cached.fetchedAt) < ttl) return cached;
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const request = Promise.resolve().then(async () => {
      try {
        const data = parseOrionTraffic(await fetchReport(from, to));
        if (data.from !== from || data.to !== to) throw new Error("Orion returned a different reporting window");
        const report = { data, fetchedAt: new Date(now()).toISOString(), stale: false };
        if (snapshots.size >= 100) snapshots.delete(snapshots.keys().next().value!);
        snapshots.set(key, report);
        return report;
      } catch (error) {
        if (!cached) throw error;
        // Do not disguise an outage as zero usage, or update last-success time.
        const stale = { ...cached, stale: true, refreshError: "Orion refresh failed. Showing the last successful report for this period." };
        snapshots.set(key, stale);
        return stale;
      } finally {
        pending.delete(key);
      }
    });
    pending.set(key, request);
    return request;
  };
}
