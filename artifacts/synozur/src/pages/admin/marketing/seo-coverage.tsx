import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  api,
  type SeoCoverageOverview,
  type SeoCoverageRun,
  type SeoCoverageUrlRow,
  type SeoResubmittedUrlRow,
  type SeoCredentialPreflightResult,
  type SeoCoverageScanStartResult,
  type SeoProviderIndexingTrend,
} from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  home: "Home",
  insight: "Insights",
  service: "Services",
  solution: "Solutions",
  application: "Applications",
  "case-study": "Case studies",
  model: "Models",
  workshop: "Workshops",
  webinar: "Webinars",
  library: "Library",
  team: "Team",
  faq: "FAQ",
  static: "Static pages",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function fmtReportingDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function fmtSigned(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value}`;
}

function fmtRate(value: number | null): string {
  if (value === null) return "Collecting";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}/day`;
}

function IndexingTrendCard({
  trend,
}: {
  trend: SeoProviderIndexingTrend;
}) {
  const isGoogle = trend.provider === "google";
  const latest = trend.days.at(-1);
  const paceClass =
    trend.averageNetNewPerDay === null
      ? "text-muted-foreground"
      : trend.averageNetNewPerDay > 0
        ? "text-emerald-700 dark:text-emerald-400"
        : trend.averageNetNewPerDay < 0
          ? "text-red-700 dark:text-red-400"
          : "text-muted-foreground";

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">
            {isGoogle ? "Google indexing pace" : "Bing verification pace"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isGoogle
              ? "Whole-site movement is measured only from complete daily Google snapshots."
              : "Bing checks a rate-limited rotating sample; this is evidence, not a whole-site index estimate."}
          </p>
        </div>
        <span
          className={
            isGoogle
              ? "text-xs font-medium text-emerald-700 dark:text-emerald-400"
              : "text-xs font-medium text-sky-700 dark:text-sky-400"
          }
        >
          {isGoogle ? "Full-site" : "Rotating sample"}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">
            Confirmed newly indexed
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {latest ? latest.confirmedNewlyIndexed : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {latest ? `${fmtReportingDate(latest.date)} · only explicit not-indexed → indexed changes` : "Baseline begins after the next completed scan"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            {isGoogle ? "Net index movement" : "Latest checked sample"}
          </p>
          <p
            className={
              isGoogle
                ? `mt-1 text-xl font-semibold tabular-nums ${
                    latest?.netIndexedChange === null ||
                    latest?.netIndexedChange === undefined
                      ? "text-muted-foreground"
                      : latest.netIndexedChange > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : latest.netIndexedChange < 0
                          ? "text-red-700 dark:text-red-400"
                          : ""
                  }`
                : "mt-1 text-xl font-semibold tabular-nums"
            }
          >
            {isGoogle
              ? fmtSigned(latest?.netIndexedChange ?? null)
              : latest
                ? `${latest.checkedUrlCount} / ${latest.sitemapUrlCount}`
                : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isGoogle
              ? "Compared with the previous complete daily snapshot"
              : "URLs with a usable Bing verdict in the latest run"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            {isGoogle ? "Average net pace" : "Estimated full recheck"}
          </p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${isGoogle ? paceClass : ""}`}>
            {isGoogle
              ? fmtRate(trend.averageNetNewPerDay)
              : trend.estimatedDaysForFullRecheck !== null
                ? `${trend.estimatedDaysForFullRecheck} days`
                : "Collecting"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isGoogle
              ? `${trend.completeSnapshotDays} complete daily snapshots`
              : "At the recent rate of Bing checks, not indexing"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            {isGoogle ? "Projection to full index" : "Whole-site index ETA"}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {isGoogle
              ? trend.projectedDaysToFullIndex !== null
                ? `${trend.projectedDaysToFullIndex} days`
                : "Not ready"
              : "Unavailable"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isGoogle
              ? trend.projectedDaysToFullIndex !== null
                ? "Based on seven consecutive positive daily Google changes"
                : "Requires seven consecutive positive daily changes from complete Google snapshots"
              : "Bing's rotating sample cannot prove a sitewide pace"}
          </p>
        </div>
      </div>

      {trend.days.length > 0 ? (
        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Daily evidence
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Day</th>
                  <th className="pb-2 font-medium">New</th>
                  <th className="pb-2 font-medium">
                    {isGoogle ? "Net" : "Checked"}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {isGoogle ? "Indexed" : "Scope"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...trend.days].reverse().map((day) => (
                  <tr key={day.date} className="border-t border-border/60">
                    <td className="py-2 font-medium">{fmtReportingDate(day.date)}</td>
                    <td className="py-2 tabular-nums">
                      {day.confirmedNewlyIndexed}
                    </td>
                    <td className="py-2 tabular-nums">
                      {isGoogle
                        ? fmtSigned(day.netIndexedChange)
                        : `${day.checkedUrlCount}/${day.sitemapUrlCount}`}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {isGoogle
                        ? day.isComplete
                          ? `${day.indexedUrlCount}/${day.sitemapUrlCount}`
                          : "Partial"
                        : day.isComplete
                          ? "Full"
                          : "Sample"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
          The first completed scan after this release establishes the baseline.
        </p>
      )}
    </Card>
  );
}

const BUCKETS = [
  {
    key: "indexed",
    label: "Confirmed indexed",
    className: "text-emerald-600",
  },
  {
    key: "discovered-not-indexed",
    label: "Confirmed not indexed",
    className: "text-amber-600",
  },
  { key: "crawl-error", label: "Crawl error", className: "text-red-600" },
  { key: "soft-404", label: "Soft 404", className: "text-red-600" },
  {
    key: "unknown",
    label: "Inspected — unknown",
    className: "text-muted-foreground",
  },
  {
    key: "pending-inspection",
    label: "Pending inspection",
    className: "text-sky-700 dark:text-sky-400",
  },
] as const;

function PreflightProviderRow({
  label,
  result,
}: {
  label: string;
  result: SeoCredentialPreflightResult["google"] | SeoCredentialPreflightResult["bing"];
}) {
  if (!result.configured) {
    return (
      <div className="flex items-start gap-2 text-muted-foreground">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{label}: not configured</span>
      </div>
    );
  }
  if (result.ok) {
    return (
      <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{label}: credentials OK</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
      <div>
        <span className="font-medium">{label}: credential error</span>
        {result.reason ? (
          <p className="mt-1 font-mono text-xs bg-red-50 dark:bg-red-950/40 rounded p-2 break-all text-red-800 dark:text-red-300">
            {result.reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function bucketCount(
  row: SeoCoverageOverview["byKind"][number],
  key: string,
): number {
  switch (key) {
    case "indexed":
      return row.indexed;
    case "discovered-not-indexed":
      return row.discoveredNotIndexed;
    case "crawl-error":
      return row.crawlError;
    case "soft-404":
      return row.soft404;
    case "pending-inspection":
      return row.pendingInspection;
    default:
      return row.unknown;
  }
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function runProgressLabel(run: SeoCoverageRun): string | null {
  const progress = run.progress;
  if (!progress) return null;
  if (progress.totalUrlCount === 0) {
    return progress.state === "running"
      ? "Preparing URL inventory"
      : "Stalled while preparing URL inventory";
  }
  return `${progress.state === "running" ? "In progress" : "Stalled"} · ${
    progress.completedUrlCount
  } / ${progress.totalUrlCount} URLs complete`;
}

function scanStartMessage(result: SeoCoverageScanStartResult): string {
  switch (result.status) {
    case "started":
      return "New scan started. Progress will update as URLs finish.";
    case "already-running":
      return "No new scan was started. Another run already holds the scanner.";
    case "scanner-held":
      return "No new scan was started. Another server process still holds the scanner; try again shortly.";
  }
}

export default function MarketingSeoCoverage() {
  const { access } = useAdminAccess();
  const canModerate = !!access?.hasCapability("content.moderate");
  const qc = useQueryClient();

  const [drill, setDrill] = useState<{ kind: string; bucket: string } | null>(
    null,
  );
  const [resubmittedRunId, setResubmittedRunId] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{
    kind: "success" | "warning";
    text: string;
  } | null>(null);

  const overview = useQuery<SeoCoverageOverview>({
    queryKey: ["seo-coverage"],
    queryFn: () => api.seoCoverage(),
    enabled: canModerate,
    // The API marks a run stalled when its progress stops. Keep polling
    // healthy long-running scans instead of imposing a browser-only timeout.
    refetchInterval: (query) => (query.state.data?.scanRunning ? 5000 : false),
  });

  const urls = useQuery<{ rows: SeoCoverageUrlRow[] }>({
    queryKey: ["seo-coverage-urls", drill?.kind, drill?.bucket],
    queryFn: () =>
      api.seoCoverageUrls({
        kind: drill?.kind,
        bucket: drill?.bucket,
        limit: 200,
      }),
    enabled: canModerate && !!drill,
  });

  const resubmitted = useQuery<{ rows: SeoResubmittedUrlRow[] }>({
    queryKey: ["seo-coverage-resubmitted", resubmittedRunId],
    queryFn: () => api.seoCoverageRunResubmitted(resubmittedRunId!),
    enabled: canModerate && !!resubmittedRunId,
  });

  const runs = useQuery<{ runs: SeoCoverageRun[] }>({
    queryKey: ["seo-coverage-runs"],
    queryFn: () => api.seoCoverageRuns(),
    enabled: canModerate,
    refetchInterval: overview.data?.scanRunning ? 5000 : false,
  });

  const scan = useMutation({
    mutationFn: () => api.seoCoverageScan(),
    onSuccess: (result) => {
      setScanMessage({
        kind: result.started ? "success" : "warning",
        text: scanStartMessage(result),
      });
      void qc.invalidateQueries({ queryKey: ["seo-coverage"] });
      void qc.invalidateQueries({ queryKey: ["seo-coverage-runs"] });
    },
  });

  // Auto-run the credential preflight when there is no scan history yet or
  // when the last scan raised a Google auth warning — so misconfiguration is
  // surfaced immediately without requiring a manual button click.
  const shouldRunPreflight =
    canModerate &&
    !!overview.data &&
    (!overview.data.lastRun || !!overview.data.googleAuthWarning);

  const preflight = useQuery<SeoCredentialPreflightResult, Error>({
    queryKey: ["seo-coverage-preflight"],
    queryFn: () => api.seoCoveragePreflight(),
    enabled: shouldRunPreflight,
    // Don't re-run on window focus or on a tight interval — one check per
    // page load (or until the user triggers a rescan that clears the warning).
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (!canModerate) {
    return (
      <AdminLayout
        title="SEO Coverage"
        crumbs={[
          { label: "Admin", href: "/" },
          { label: "Marketing" },
          { label: "SEO Coverage" },
        ]}
      >
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            You don't have permission to view SEO coverage.
          </p>
        </Card>
      </AdminLayout>
    );
  }

  const data = overview.data;

  return (
    <AdminLayout
      title="SEO Coverage"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Marketing" },
        { label: "SEO Coverage" },
      ]}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => scan.mutate()}
          disabled={scan.isPending || data?.scanRunning}
          data-testid="button-seo-coverage-scan"
        >
          {scan.isPending || data?.scanRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {data?.scanRunning ? "Scan running…" : "Rescan now"}
        </Button>
      }
    >
      {overview.isLoading ? (
        <Card className="p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : overview.isError ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">
            Failed to load coverage:{" "}
            {overview.error instanceof Error
              ? overview.error.message
              : "unknown error"}
          </p>
        </Card>
      ) : data ? (
        <div className="space-y-6">
          {scanMessage ? (
            <Card
              className={`p-4 text-sm ${
                scanMessage.kind === "success"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              }`}
              role="status"
            >
              {scanMessage.text}
            </Card>
          ) : null}

          {/* Provider configuration + last run */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
              <div className="flex items-center gap-2">
                {data.googleConfigured ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                <span>
                  Google Search Console{" "}
                  <span className="text-muted-foreground">
                    {data.googleConfigured
                      ? "configured"
                      : "not configured (set GOOGLE_INDEXING_SA_JSON + GOOGLE_SEARCH_CONSOLE_SITE_URL)"}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {data.bingConfigured ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                <span>
                  Bing Webmaster{" "}
                  <span className="text-muted-foreground">
                    {data.bingConfigured
                      ? "configured"
                      : "not configured (set BING_API_KEY + BING_SITE_URL)"}
                  </span>
                </span>
              </div>
              <div className="text-muted-foreground">
                Last scan: {fmt(data.lastRun?.finishedAt ?? data.lastRun?.startedAt)}
                {data.lastRun
                  ? data.lastRun.progress
                    ? ` · ${runProgressLabel(data.lastRun)}`
                    : ` · ${data.lastRun.urlCount} URLs · Google checked ${data.lastRun.googleChecked} · Bing checked ${data.lastRun.bingChecked}`
                  : " · never run"}
                {data.lastRun &&
                data.lastRun.resubmittedCount != null &&
                data.lastRun.resubmittedCount > 0 ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    · Resubmitted:{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:no-underline"
                      onClick={() => {
                        setResubmittedRunId(
                          resubmittedRunId === data.lastRun!.id
                            ? null
                            : data.lastRun!.id,
                        );
                        setDrill(null);
                      }}
                      data-testid="button-seo-coverage-resubmitted"
                    >
                      {data.lastRun.resubmittedCount} not-indexed{" "}
                      {data.lastRun.resubmittedCount === 1 ? "URL" : "URLs"}
                    </button>
                  </span>
                ) : null}
                {data.lastRun?.error ? (
                  <span className="text-red-600"> · error: {data.lastRun.error}</span>
                ) : null}
              </div>
            </div>
          </Card>

          {data.lastRun?.progress?.state === "stalled" ? (
            <Card
              className="p-5 border-amber-300 bg-amber-50 dark:bg-amber-950/30"
              data-testid="seo-coverage-stalled-recovery"
            >
              <div className="flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-2">
                  <p>
                    <strong>Scan needs recovery:</strong>{" "}
                    {runProgressLabel(data.lastRun)}.
                  </p>
                  <p>
                    It last made progress {fmt(data.lastRun.progress.lastProgressAt)}.
                    This run is no longer being polled. Click <strong>Rescan now</strong>{" "}
                    to start a replacement scan. If the request says another scanner
                    still holds the lock, wait briefly and try again.
                  </p>
                </div>
              </div>
            </Card>
          ) : null}

          {data.indexingTrends ? (
            <section aria-label="Indexing pace">
              <div className="mb-3">
                <h2 className="text-base font-semibold">Indexing pace</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Track confirmed additions to each engine and use complete
                  Google snapshots to see whether the indexing backlog is
                  actually shrinking.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <IndexingTrendCard trend={data.indexingTrends.google} />
                <IndexingTrendCard trend={data.indexingTrends.bing} />
              </div>
            </section>
          ) : null}

          {/* Credential health — auto-runs when no scan has ever run or the
              last scan raised a Google auth warning. */}
          {(preflight.isFetching || preflight.data || preflight.isError) ? (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Credential health
                {preflight.isFetching && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {preflight.isError ? (
                <p className="text-sm text-red-600">
                  Check failed: {preflight.error.message}
                </p>
              ) : preflight.data ? (
                <div className="space-y-2 text-sm">
                  <PreflightProviderRow
                    label="Google Search Console"
                    result={preflight.data.google}
                  />
                  <PreflightProviderRow
                    label="Bing Webmaster"
                    result={preflight.data.bing}
                  />
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* Google auth warning */}
          {data.googleQuotaWarning ? (
            <Card className="p-5 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              <div className="flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-2">
                  <p>
                    <strong>Google URL Inspection quota exhausted:</strong>{" "}
                    Google could not return a coverage verdict for one or more
                    sitemap URLs in this scan. This is a quota limitation, not
                    a missing credential or Search Console permission.
                  </p>
                  <p>
                    Those URLs remain in <strong>Pending inspection</strong>{" "}
                    and will be retried by a later scan.
                  </p>
                  {data.googleLastError ? (
                    <p className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 rounded p-2 break-all">
                      {data.googleLastError}
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}

          {data.googleAuthWarning ? (
            <Card className="p-5 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              <div className="flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-2">
                  <p>
                    <strong>Google Search Console:</strong> 0 URLs were
                    successfully checked in the last scan despite being
                    configured.
                  </p>
                  {data.googleLastError ? (
                    <p className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 rounded p-2 break-all">
                      {data.googleLastError}
                    </p>
                  ) : null}
                  {data.googleServiceAccountEmail && data.googleSiteUrl ? (
                    <p>
                      To fix: in{" "}
                      <a
                        href="https://search.google.com/search-console/users"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        Search Console → Settings → Users and permissions
                      </a>{" "}
                      for the property{" "}
                      <code className="font-mono text-xs">{data.googleSiteUrl}</code>
                      , add{" "}
                      <code className="font-mono text-xs">
                        {data.googleServiceAccountEmail}
                      </code>{" "}
                      as a user (Full permission). Then click{" "}
                      <strong>Rescan now</strong>.
                    </p>
                  ) : null}
                  <p>
                    Common fixes:{" "}
                    <strong>(1)</strong> Enable the{" "}
                    <a
                      href="https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Google Search Console API
                    </a>{" "}
                    in your GCP project.{" "}
                    <strong>(2)</strong> Add the service account email as a user
                    on the Search Console property.{" "}
                    <strong>(3)</strong> Confirm the service account has the{" "}
                    <code className="font-mono text-xs">webmasters.readonly</code>{" "}
                    scope. After fixing, click{" "}
                    <strong>Rescan now</strong>.
                  </p>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Bing throttle warning */}
          {data.bingThrottleWarning ? (
            <Card className="p-5 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              <div className="flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p>
                    <strong>Bing Webmaster:</strong> Bing rate-limited this
                    scan, so some sitemap URLs are marked{" "}
                    <strong>Pending inspection</strong> rather than being
                    treated as crawl failures. The Bing API typically allows
                    only 10–40 URL checks per run. Coverage is rotated
                    automatically and results will accumulate over multiple
                    daily scans.
                  </p>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Per-artifact-type buckets */}
          {data.byKind.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">
                {!data.lastRun
                  ? "No scan has run yet. Click 'Rescan now' to start."
                  : "No crawlable sitemap inventory is stored yet. Check the latest scan above."}
                {(!data.googleConfigured || !data.bingConfigured) &&
                data.lastRun ? (
                  <span>
                    {" "}
                    ({!data.googleConfigured ? "Google Search Console" : ""}
                    {!data.googleConfigured && !data.bingConfigured ? " and " : ""}
                    {!data.bingConfigured ? "Bing Webmaster" : ""} not
                    configured.)
                  </span>
                ) : null}
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <caption className="caption-top px-4 py-3 text-left text-xs text-muted-foreground">
                  Every currently crawlable sitemap URL is included. Confirmed
                  buckets come from a usable provider inspection; pending URLs
                  are still in the sitemap but have not received one yet.
                </caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Artifact type</th>
                    <th className="px-4 py-2 font-medium text-right">
                      Sitemap URLs
                    </th>
                    {BUCKETS.map((b) => (
                      <th
                        key={b.key}
                        className="px-4 py-2 font-medium text-right"
                      >
                        {b.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byKind.map((row) => (
                    <tr key={row.kind} className="border-t">
                      <td className="px-4 py-2">{kindLabel(row.kind)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {row.total}
                      </td>
                      {BUCKETS.map((b) => {
                        const n = bucketCount(row, b.key);
                        return (
                          <td
                            key={b.key}
                            className="px-4 py-2 text-right tabular-nums"
                          >
                            {n > 0 ? (
                              <button
                                type="button"
                                className={`underline-offset-2 hover:underline ${b.className}`}
                                onClick={() =>
                                  setDrill({ kind: row.kind, bucket: b.key })
                                }
                                data-testid={`seo-coverage-cell-${row.kind}-${b.key}`}
                              >
                                {n}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Resubmitted URLs drill-down */}
          {resubmittedRunId ? (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Resubmitted URLs — {fmt(data.lastRun?.finishedAt ?? data.lastRun?.startedAt)}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResubmittedRunId(null)}
                >
                  Close
                </Button>
              </div>
              {resubmitted.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : resubmitted.isError ? (
                <p className="text-sm text-red-600">
                  Failed to load resubmitted URLs.
                </p>
              ) : (resubmitted.data?.rows ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No resubmitted URLs recorded for this run.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    These URLs were classified as not-indexed and nudged to search engines after the scan.
                    "Current status" reflects the latest scan result.
                  </p>
                  <div className="space-y-1">
                    {(resubmitted.data?.rows ?? []).map((r) => {
                      const currentBucket =
                        r.currentGoogleBucket &&
                        r.currentGoogleBucket !== "error" &&
                        r.currentGoogleBucket !== "not-configured"
                          ? r.currentGoogleCoverageState ?? r.currentGoogleBucket
                          : r.currentBingBucket &&
                              r.currentBingBucket !== "not-configured"
                            ? `Bing: ${r.currentBingBucket}`
                            : null;
                      const isNowIndexed =
                        r.currentGoogleBucket === "indexed" ||
                        r.currentBingBucket === "indexed";
                      return (
                        <div
                          key={r.url}
                          className="flex items-center justify-between gap-4 border-b py-1.5 text-sm last:border-b-0"
                        >
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 truncate text-blue-600 hover:underline"
                          >
                            {r.path}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <span
                            className={`shrink-0 tabular-nums ${
                              isNowIndexed
                                ? "text-emerald-600"
                                : r.currentGoogleBucket === null
                                  ? "text-muted-foreground"
                                  : "text-amber-600"
                            }`}
                          >
                            {r.currentGoogleBucket === null
                              ? "no longer tracked"
                              : (currentBucket ?? "—")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {/* Scan history — lets admins drill into any past run's resubmitted URLs */}
          {(runs.data?.runs ?? []).length > 0 ? (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-sm font-medium">Scan history</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Trigger</th>
                    <th className="px-4 py-2 font-medium text-right">
                      URLs
                    </th>
                    <th className="px-4 py-2 font-medium text-right">Google</th>
                    <th className="px-4 py-2 font-medium text-right">Bing</th>
                    <th className="px-4 py-2 font-medium text-right">Resubmitted</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs.data?.runs ?? []).map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="px-4 py-2 text-muted-foreground">
                        {fmt(run.finishedAt ?? run.startedAt)}
                        {run.progress ? (
                          <span
                            className={
                              run.progress.state === "running"
                                ? "ml-2 text-sky-700 dark:text-sky-400"
                                : "ml-2 text-amber-700 dark:text-amber-400"
                            }
                          >
                            {run.progress.state === "running"
                              ? "In progress"
                              : "Stalled"}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground capitalize">
                        {run.trigger}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {run.progress
                          ? run.progress.totalUrlCount === 0
                            ? "Preparing…"
                            : `${run.progress.completedUrlCount} / ${run.progress.totalUrlCount}`
                          : run.urlCount}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {run.googleChecked}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {run.bingChecked}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {run.resubmittedCount != null && run.resubmittedCount > 0 ? (
                          <button
                            type="button"
                            className="text-amber-700 dark:text-amber-400 underline-offset-2 hover:underline"
                            onClick={() => {
                              setResubmittedRunId(
                                resubmittedRunId === run.id ? null : run.id,
                              );
                              setDrill(null);
                            }}
                            data-testid={`seo-coverage-run-resubmitted-${run.id}`}
                          >
                            {run.resubmittedCount}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">
                            {run.resubmittedCount ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          {/* Drill-down */}
          {drill ? (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {kindLabel(drill.kind)} ·{" "}
                  {BUCKETS.find((b) => b.key === drill.bucket)?.label ??
                    drill.bucket}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDrill(null)}
                >
                  Close
                </Button>
              </div>
              {urls.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="space-y-1">
                  {(urls.data?.rows ?? []).map((r) => (
                    <div
                      key={r.url}
                      className="flex items-center justify-between gap-4 border-b py-1.5 text-sm last:border-b-0"
                    >
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 truncate text-blue-600 hover:underline"
                      >
                        {r.path}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <span className="shrink-0 text-muted-foreground">
                        {!r.googleBucket ||
                        r.googleBucket === "error" ||
                        r.googleBucket === "not-configured"
                          ? r.bingBucket && r.bingBucket !== "not-configured"
                            ? `Bing: ${r.bingBucket}`
                            : "—"
                          : r.googleCoverageState ?? r.googleBucket ?? "—"}
                        {r.googleBucket &&
                        r.googleBucket !== "error" &&
                        r.googleBucket !== "not-configured" &&
                        r.bingBucket &&
                        r.bingBucket !== "not-configured"
                          ? ` · Bing: ${r.bingBucket}`
                          : ""}
                      </span>
                    </div>
                  ))}
                  {(urls.data?.rows ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No URLs in this bucket.
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </AdminLayout>
  );
}
