import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, Orbit } from "lucide-react";
import {
  useGetCmsOrionTraffic,
  getGetCmsOrionTrafficQueryKey,
  getCmsOrionTraffic,
  type OrionTrafficSnapshot,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { computeOrionWindow, type OrionRangePreset } from "@/lib/orion-traffic-window";

const PRESET_LABELS: Record<OrionRangePreset, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "183": "Last 6 months",
  ytd: "Year to date",
  "365": "Last 12 months",
};

const EVENT_LABELS: Record<string, string> = {
  pageview: "Page visit",
  page_view: "Page visit",
  assessment_started: "Assessment started",
  assessment_completed: "Assessment completed",
  assessment_submitted: "Assessment submitted",
  course_started: "Course started",
  course_completed: "Course completed",
  lesson_started: "Lesson started",
  lesson_completed: "Lesson completed",
  module_completed: "Module completed",
  interactive_started: "Interactive started",
  interactive_completed: "Interactive completed",
  model_viewed: "Model viewed",
  quiz_submitted: "Quiz submitted",
};

const RESOURCE_LABELS: Record<string, string> = {
  model: "Models",
  course: "Courses",
  interactive: "Interactives",
};

const SOURCE_LABELS: Record<string, string> = {
  browser: "Browser event",
  record: "Stored record",
};

function humanize(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : s;
}
function eventLabel(e: string) {
  return EVENT_LABELS[e] ?? humanize(e);
}
function sourceLabel(s: string) {
  return SOURCE_LABELS[s] ?? humanize(s);
}
function pageLabel(p: string) {
  const k = p.toLowerCase();
  if (k === "signup" || k === "sign-up" || k === "/signup" || k === "sign_up")
    return "Authentication (legacy signup page)";
  return p;
}
function sectionLabel(s: string) {
  const k = s.toLowerCase();
  if (k === "signup" || k === "sign-up" || k === "sign_up") return "Authentication (legacy signup)";
  return humanize(s);
}

function utcDayKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function fmtDateTime(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
const n = (v: number) => v.toLocaleString();

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground py-3">{children}</div>;
}

function CountTable({
  caption,
  head,
  rows,
  testid,
  empty,
}: {
  caption: string;
  head: [string, string];
  rows: { key: string; label: ReactNode; count: number }[];
  testid: string;
  empty: string;
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto max-h-72 overflow-y-auto">
      <table className="w-full text-sm" data-testid={testid}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="text-left py-1.5 font-medium text-muted-foreground text-xs">{head[0]}</th>
            <th scope="col" className="text-right py-1.5 font-medium text-muted-foreground text-xs">{head[1]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key} data-testid={`${testid}-row-${r.key}`}>
              <td className="py-1.5 pr-2 break-all">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">{n(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-4 min-w-0">
      <div className="text-sm font-medium">{title}</div>
      {sub && <div className="text-xs text-muted-foreground mb-2">{sub}</div>}
      <div className={sub ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

export function OrionTrafficPanel({
  rangePreset,
  enabled,
}: {
  rangePreset: OrionRangePreset;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [dayKey, setDayKey] = useState(() => utcDayKey(new Date()));

  // Roll the window over at the next UTC midnight.
  useEffect(() => {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1);
    const t = window.setTimeout(() => setDayKey(utcDayKey(new Date())), Math.max(1000, next - now.getTime()));
    return () => window.clearTimeout(t);
  }, [dayKey]);

  const params = useMemo(
    () => computeOrionWindow(rangePreset, new Date(`${dayKey}T12:00:00Z`)),
    [rangePreset, dayKey],
  );
  const queryKey = useMemo(() => getGetCmsOrionTrafficQueryKey(params), [params]);

  const q = useGetCmsOrionTraffic(params, {
    query: { queryKey, enabled, refetchInterval: 60000, staleTime: 0, retry: 1 },
  });

  const [refreshing, setRefreshing] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => setManualError(null), [queryKey, q.data?.fetchedAt]);

  async function handleRefresh() {
    setRefreshing(true);
    setManualError(null);
    try {
      const result = await getCmsOrionTraffic({ ...params, refresh: true });
      queryClient.setQueryData<OrionTrafficSnapshot>(queryKey, result);
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Refresh request failed");
    } finally {
      setRefreshing(false);
    }
  }

  const snap = q.data;
  const data = snap?.data;
  const bgError = q.isError && !!snap;
  const isStale = !!snap && (snap.stale || !!snap.refreshError || !!manualError || bgError);

  return (
    <Card className="p-5 mb-6" data-testid="card-orion-traffic" aria-labelledby="orion-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 id="orion-heading" className="text-sm font-medium flex items-center gap-2">
            <Orbit className="h-4 w-4 text-primary" aria-hidden /> Orion — app-wide snapshot
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Read-only, authoritative report fetched from Orion. Not stored locally and not added to
            the local totals below. Only the Range filter applies; property, audience, page type and
            device filters do not affect this panel.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={!enabled || refreshing}
          data-testid="button-orion-refresh"
          aria-label="Refresh Orion snapshot now"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
          {refreshing ? "Refreshing…" : "Refresh now"}
        </Button>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs mb-4" data-testid="orion-meta">
        <div>
          <dt className="text-muted-foreground">Report window (UTC)</dt>
          <dd className="font-medium" data-testid="text-orion-window">
            {PRESET_LABELS[rangePreset]}: {fmtDate(params.from)} – {fmtDate(params.to)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Snapshot fetched</dt>
          <dd className="font-medium" data-testid="text-orion-fetched-at">
            {snap ? fmtDateTime(snap.fetchedAt) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Update cadence</dt>
          <dd>Checked every minute while open; cached for 5 minutes. Refresh now bypasses the cache.</dd>
        </div>
      </dl>

      <div aria-live="polite">
        {isStale && (
          <div
            role="status"
            className="flex gap-2 items-start rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs mb-4"
            data-testid="status-orion-stale"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div>
              <div className="font-medium">Showing last successful snapshot — data may be stale.</div>
              {manualError && <div>Manual refresh failed: {manualError}</div>}
              {snap?.refreshError && <div>Server refresh error: {snap.refreshError}</div>}
              {bgError && !manualError && <div>Latest background check failed.</div>}
            </div>
          </div>
        )}
        {!enabled ? null : q.isLoading ? (
          <div className="space-y-3" data-testid="status-orion-loading" aria-busy="true">
            <span className="sr-only">Loading Orion snapshot</span>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
            <Skeleton className="h-40" />
          </div>
        ) : !data ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
            data-testid="status-orion-error"
          >
            <div className="font-medium">Orion report unavailable.</div>
            <div className="text-xs text-muted-foreground mt-1">
              No snapshot could be loaded, so no counts are shown.
              {manualError ? ` ${manualError}` : ""}
            </div>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => q.refetch()} data-testid="button-orion-retry">
              Retry
            </Button>
          </div>
        ) : (
          <OrionBody snap={snap!} />
        )}
      </div>
    </Card>
  );
}

function OrionBody({ snap }: { snap: OrionTrafficSnapshot }) {
  const data = snap.data;
  const a = data.activity;
  const resourceGroups = useMemo(() => {
    const m = new Map<string, typeof a.byResource>();
    for (const r of a.byResource) {
      const arr = m.get(r.resourceType) ?? [];
      arr.push(r);
      m.set(r.resourceType, arr);
    }
    return [...m.entries()];
  }, [a.byResource]);

  const daily = useMemo(() => {
    const m = new Map<string, { v?: number; a?: number }>();
    for (const d of data.byDate) m.set(d.date, { ...(m.get(d.date) ?? {}), v: d.count });
    for (const d of a.timeSeries) m.set(d.date, { ...(m.get(d.date) ?? {}), a: d.count });
    return [...m.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));
  }, [data.byDate, a.timeSeries]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border border-border p-4" data-testid="stat-orion-visits">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Orion page visits</div>
          <div className="text-3xl font-semibold mt-1 tabular-nums">{n(data.totalVisits)}</div>
          <div className="text-xs text-muted-foreground">Visits, not sessions or unique people.</div>
        </div>
        <div className="rounded-md border border-border p-4" data-testid="stat-orion-activity">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Learning & assessment activity</div>
          <div className="text-3xl font-semibold mt-1 tabular-nums">{n(a.totalEvents)}</div>
          <div className="text-xs text-muted-foreground">Activity events, counted separately from visits.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Block title="Visits by section">
          <CountTable
            caption="Orion visits by section"
            head={["Section", "Visits"]}
            testid="table-orion-sections"
            empty="No section visits in this window."
            rows={data.bySection.map((r) => ({ key: r.section, label: sectionLabel(r.section), count: r.count }))}
          />
        </Block>
        <Block title="Visits by page" sub="Legacy signup visits are Authentication page visits, not registrations.">
          <CountTable
            caption="Orion visits by page"
            head={["Page", "Visits"]}
            testid="table-orion-pages"
            empty="No page visits in this window."
            rows={data.byPage.map((r) => ({ key: r.page, label: <span className="font-mono text-xs">{pageLabel(r.page)}</span>, count: r.count }))}
          />
        </Block>
      </div>

      <Block title="Activity events" sub="Every event type returned by Orion, with its source.">
        {a.byEvent.length === 0 ? (
          <Empty>No learning or assessment activity recorded in this window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-orion-events">
              <caption className="sr-only">Orion activity by event</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="text-left py-1.5 font-medium">Event</th>
                  <th scope="col" className="text-left py-1.5 font-medium">Source</th>
                  <th scope="col" className="text-right py-1.5 font-medium">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.byEvent.map((e) => (
                  <tr key={`${e.event}-${e.source}`} data-testid={`row-orion-event-${e.event}-${e.source}`}>
                    <td className="py-1.5">
                      {eventLabel(e.event)}
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">{e.event}</span>
                    </td>
                    <td className="py-1.5">
                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px]">{sourceLabel(e.source)}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{n(e.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <Block title="Activity by resource" sub="Models, courses and interactives with per-event counts.">
        {resourceGroups.length === 0 ? (
          <Empty>No resource-level activity in this window.</Empty>
        ) : (
          <div className="space-y-4">
            {resourceGroups.map(([type, items]) => (
              <div key={type} data-testid={`group-orion-resource-${type}`}>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {RESOURCE_LABELS[type] ?? humanize(type)}
                </div>
                <ul className="divide-y divide-border">
                  {items.map((r) => (
                    <li key={r.resourceId} className="py-2 text-sm" data-testid={`row-orion-resource-${type}-${r.resourceId}`}>
                      <div className="flex justify-between gap-2">
                        <span className="font-medium min-w-0 break-words">{r.resourceName || r.resourceId}</span>
                        <span className="tabular-nums shrink-0">{n(r.count)}</span>
                      </div>
                      {Object.keys(r.byEvent).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {Object.entries(r.byEvent).map(([ev, c]) => (
                            <span key={ev} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                              {eventLabel(ev)}: <span className="tabular-nums">{n(c)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Daily visits and activity" sub="Most recent first. Blank cells mean Orion returned no row for that day.">
        {daily.length === 0 ? (
          <Empty>No daily data in this window.</Empty>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm" data-testid="table-orion-daily">
              <caption className="sr-only">Orion daily visits and activity</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="text-left py-1.5 font-medium">Date (UTC)</th>
                  <th scope="col" className="text-right py-1.5 font-medium">Visits</th>
                  <th scope="col" className="text-right py-1.5 font-medium">Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {daily.map(([date, v]) => (
                  <tr key={date}>
                    <td className="py-1.5 font-mono text-xs">{date}</td>
                    <td className="py-1.5 text-right tabular-nums">{v.v !== undefined ? n(v.v) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{v.a !== undefined ? n(v.a) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <details className="rounded-md border border-border p-4 group" data-testid="details-orion-breakdowns">
        <summary className="text-sm font-medium cursor-pointer" data-testid="button-orion-breakdowns">
          Country, device and browser breakdowns (visits)
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <CountTable caption="Visits by country" head={["Country", "Visits"]} testid="table-orion-countries" empty="No country data."
            rows={data.byCountry.map((r) => ({ key: r.country, label: r.country, count: r.count }))} />
          <CountTable caption="Visits by device" head={["Device", "Visits"]} testid="table-orion-devices" empty="No device data."
            rows={data.byDevice.map((r) => ({ key: r.device, label: humanize(r.device), count: r.count }))} />
          <CountTable caption="Visits by browser" head={["Browser", "Visits"]} testid="table-orion-browsers" empty="No browser data."
            rows={data.byBrowser.map((r) => ({ key: r.browser, label: r.browser, count: r.count }))} />
        </div>
      </details>

      <div className="text-xs text-muted-foreground space-y-1" data-testid="orion-notes">
        <div className="font-medium text-foreground">Reporting notes</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Historical page visits are shown only as far back as Orion retains them.</li>
          <li>Expanded browser activity events are available only since their deployment; earlier periods may under-count activity.</li>
          <li>Orion does not report unique people across apps; counts are visits and events.</li>
          {a.notes.map((note, i) => (
            <li key={i} data-testid={`text-orion-note-${i}`}>{note}</li>
          ))}
        </ul>
        <div>Reporting version {data.reportingVersion}. Upstream window: {fmtDate(data.from)} – {fmtDate(data.to)}.</div>
      </div>
    </div>
  );
}

export default OrionTrafficPanel;
