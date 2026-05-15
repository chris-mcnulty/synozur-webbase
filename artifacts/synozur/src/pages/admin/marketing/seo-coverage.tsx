import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  api,
  type SeoCoverageOverview,
  type SeoCoverageUrlRow,
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

const BUCKETS = [
  { key: "indexed", label: "Indexed", className: "text-emerald-600" },
  {
    key: "discovered-not-indexed",
    label: "Discovered — not indexed",
    className: "text-amber-600",
  },
  { key: "crawl-error", label: "Crawl error", className: "text-red-600" },
  { key: "soft-404", label: "Soft 404", className: "text-red-600" },
  { key: "unknown", label: "Unknown", className: "text-muted-foreground" },
] as const;

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
    default:
      return row.unknown;
  }
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function MarketingSeoCoverage() {
  const { access } = useAdminAccess();
  const canModerate = !!access?.hasCapability("content.moderate");
  const qc = useQueryClient();

  const [drill, setDrill] = useState<{ kind: string; bucket: string } | null>(
    null,
  );

  const overview = useQuery<SeoCoverageOverview>({
    queryKey: ["seo-coverage"],
    queryFn: () => api.seoCoverage(),
    enabled: canModerate,
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

  const scan = useMutation({
    mutationFn: () => api.seoCoverageScan(),
    onSuccess: () => {
      // The scan runs out-of-band; refetch after a short delay so the
      // last-run banner reflects progress.
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["seo-coverage"] }),
        4000,
      );
    },
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
                  ? ` · ${data.lastRun.urlCount} URLs · Google checked ${data.lastRun.googleChecked} · Bing checked ${data.lastRun.bingChecked}`
                  : " · never run"}
                {data.lastRun?.error ? (
                  <span className="text-red-600"> · error: {data.lastRun.error}</span>
                ) : null}
              </div>
            </div>
          </Card>

          {/* Per-artifact-type buckets */}
          {data.byKind.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">
                No coverage data yet. Run a scan once Search Console / Bing
                credentials are configured in production.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Artifact type</th>
                    <th className="px-4 py-2 font-medium text-right">Total</th>
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
                        {r.googleCoverageState ?? r.googleBucket ?? "—"}
                        {r.bingBucket && r.bingBucket !== "not-configured"
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
