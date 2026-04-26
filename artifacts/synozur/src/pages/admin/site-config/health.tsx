import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useCmsGetSiteHealth,
  type SiteHealthSnapshot,
  type SiteHealthCwvRow,
} from "@workspace/api-client-react";

// #142 Phase B — Admin site-health dashboard. Three signals:
//   1. Core Web Vitals percentiles per (route, metric) over a sliding
//      window. Sourced from the public `/api/metrics/cwv` ingest.
//   2. Alt-text coverage for image media — counts placeholder rows
//      ("Image: …") vs editor-reviewed rows.
//   3. Redirect health — totals, top hit-count rows, and one-hop chains.
//
// The publish gate (Phase D) reads from the same CWV table and the
// Phase A alt-text fields; this v0 surface is informational only.

const WINDOW_OPTIONS = [
  { value: 1, label: "Last 24h" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
];

// CWV thresholds per https://web.dev/articles/vitals (good cutoffs).
// Used here for at-a-glance row colouring; the server is authoritative
// on the per-sample `rating` field.
const GOOD_THRESHOLD: Record<string, number> = {
  LCP: 2500,
  INP: 200,
  CLS: 0.1,
  FCP: 1800,
  TTFB: 800,
};

const POOR_THRESHOLD: Record<string, number> = {
  LCP: 4000,
  INP: 500,
  CLS: 0.25,
  FCP: 3000,
  TTFB: 1800,
};

function metricRating(metric: string, value: number): "good" | "needs-improvement" | "poor" {
  const good = GOOD_THRESHOLD[metric];
  const poor = POOR_THRESHOLD[metric];
  if (good == null || poor == null) return "needs-improvement";
  if (value <= good) return "good";
  if (value >= poor) return "poor";
  return "needs-improvement";
}

function formatMetricValue(metric: string, value: number): string {
  if (metric === "CLS") return value.toFixed(3);
  return `${Math.round(value)} ms`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export default function SiteHealth() {
  const [windowDays, setWindowDays] = useState<number>(7);
  const { data, isLoading, isError, error } = useCmsGetSiteHealth({
    windowDays,
  });

  return (
    <AdminLayout
      title="Site Health"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Site Config" },
        { label: "Health" },
      ]}
      actions={
        <Select
          value={String(windowDays)}
          onValueChange={(v) => setWindowDays(Number(v))}
        >
          <SelectTrigger className="w-40" data-testid="select-health-window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading site health…
        </div>
      )}
      {isError && (
        <Card className="p-4 border-destructive/40 bg-destructive/5 text-destructive">
          Failed to load site health: {(error as Error)?.message ?? "Unknown error"}
        </Card>
      )}
      {data && <SiteHealthDashboard snapshot={data} />}
    </AdminLayout>
  );
}

function SiteHealthDashboard({ snapshot }: { snapshot: SiteHealthSnapshot }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AltTextCard data={snapshot.altText} />
        <RedirectsTotalsCard
          totalActive={snapshot.redirects.totalActive}
          totalHits={snapshot.redirects.totalHits}
          chainCount={snapshot.redirects.chains.length}
        />
        <CwvTotalsCard rows={snapshot.cwv} windowDays={snapshot.windowDays} />
      </div>

      <CwvTable rows={snapshot.cwv} windowDays={snapshot.windowDays} />

      {snapshot.redirects.chains.length > 0 && (
        <RedirectsChainsCard chains={snapshot.redirects.chains} />
      )}

      <RedirectsTopCard top={snapshot.redirects.top} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function AltTextCard({ data }: { data: SiteHealthSnapshot["altText"] }) {
  const ratio = data.coverageRatio;
  const tone =
    ratio >= 0.85
      ? "text-emerald-300"
      : ratio >= 0.5
        ? "text-amber-300"
        : "text-red-300";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5" />
          Alt-text coverage
        </div>
      </div>
      <div className={`mt-2 text-3xl font-semibold ${tone}`}>
        {data.totalImageMedia === 0 ? "—" : formatPercent(ratio)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {data.reviewedCount} of {data.totalImageMedia} image rows have editor-written alt text.
        {data.placeholderCount > 0 && (
          <>
            {" "}
            <span className="text-amber-300">
              {data.placeholderCount} still on placeholder.
            </span>
          </>
        )}
      </div>
    </Card>
  );
}

function RedirectsTotalsCard({
  totalActive,
  totalHits,
  chainCount,
}: {
  totalActive: number;
  totalHits: number;
  chainCount: number;
}) {
  const tone = chainCount === 0 ? "text-emerald-300" : "text-amber-300";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <LinkIcon className="h-3.5 w-3.5" />
        Redirects
      </div>
      <div className="mt-2 text-3xl font-semibold">{totalActive}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        active · {totalHits.toLocaleString()} total hits
      </div>
      <div className={`mt-2 text-xs ${tone}`}>
        {chainCount === 0
          ? "No redirect chains detected."
          : `${chainCount} chain${chainCount === 1 ? "" : "s"} — flatten to save a network round-trip.`}
      </div>
    </Card>
  );
}

function CwvTotalsCard({
  rows,
  windowDays,
}: {
  rows: SiteHealthCwvRow[];
  windowDays: number;
}) {
  const totalSamples = rows.reduce((sum, r) => sum + r.sampleCount, 0);
  const goodCount = rows.filter(
    (r) => metricRating(r.metric, r.p75) === "good",
  ).length;
  const poorCount = rows.filter(
    (r) => metricRating(r.metric, r.p75) === "poor",
  ).length;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        Core Web Vitals · last {windowDays}d
      </div>
      <div className="mt-2 text-3xl font-semibold">
        {totalSamples.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        samples across {rows.length} (route, metric) pair{rows.length === 1 ? "" : "s"}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 text-xs flex gap-3">
          <span className="text-emerald-300">
            <CheckCircle2 className="inline h-3 w-3 mr-1" />
            {goodCount} good
          </span>
          {poorCount > 0 && (
            <span className="text-red-300">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {poorCount} poor
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CWV table
// ---------------------------------------------------------------------------

function CwvTable({
  rows,
  windowDays,
}: {
  rows: SiteHealthCwvRow[];
  windowDays: number;
}) {
  // Group by route so the dashboard renders one block per route with all
  // five metrics inline. Routes are ordered by total sample count desc.
  const grouped = useMemo(() => {
    const byRoute = new Map<string, SiteHealthCwvRow[]>();
    for (const row of rows) {
      const list = byRoute.get(row.route) ?? [];
      list.push(row);
      byRoute.set(row.route, list);
    }
    return Array.from(byRoute.entries())
      .map(([route, items]) => ({
        route,
        items,
        sampleCount: items.reduce((s, r) => s + r.sampleCount, 0),
      }))
      .sort((a, b) => b.sampleCount - a.sampleCount);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No CWV samples in the last {windowDays} day{windowDays === 1 ? "" : "s"}.
        Public visitors must opt in to cookies for samples to be reported.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold">Core Web Vitals by route</div>
        <div className="text-xs text-muted-foreground">
          Percentiles over the last {windowDays} day{windowDays === 1 ? "" : "s"}.
          The p75 column is the headline number search engines and procurement
          buyers care about.
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Route</TableHead>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Samples</TableHead>
            <TableHead className="text-right">p50</TableHead>
            <TableHead className="text-right">p75</TableHead>
            <TableHead className="text-right">p90</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.flatMap((g) =>
            g.items.map((row, i) => {
              const r = metricRating(row.metric, row.p75);
              const tone =
                r === "good"
                  ? "text-emerald-300"
                  : r === "poor"
                    ? "text-red-300"
                    : "text-amber-300";
              return (
                <TableRow key={`${g.route}:${row.metric}`}>
                  <TableCell className="font-mono text-xs max-w-[24rem] truncate">
                    {i === 0 ? g.route : (
                      <span className="text-muted-foreground/60">↳</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.metric}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {row.sampleCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatMetricValue(row.metric, row.p50)}
                  </TableCell>
                  <TableCell className={`text-right text-xs font-medium ${tone}`}>
                    {formatMetricValue(row.metric, row.p75)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatMetricValue(row.metric, row.p90)}
                  </TableCell>
                </TableRow>
              );
            }),
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Redirect tables
// ---------------------------------------------------------------------------

function RedirectsChainsCard({
  chains,
}: {
  chains: SiteHealthSnapshot["redirects"]["chains"];
}) {
  return (
    <Card className="overflow-hidden border-amber-500/30">
      <div className="px-4 py-3 border-b border-border bg-amber-500/5">
        <div className="text-sm font-semibold text-amber-200 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          Redirect chains ({chains.length})
        </div>
        <div className="text-xs text-amber-200/70 mt-1">
          Each row's target is itself the source of another redirect. Flatten
          these so visitors and crawlers don't pay the extra hop.
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="text-right">Hits</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chains.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs max-w-[24rem] truncate">
                {c.sourcePath}
              </TableCell>
              <TableCell className="font-mono text-xs max-w-[24rem] truncate">
                {c.targetPath}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {c.hitCount.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function RedirectsTopCard({
  top,
}: {
  top: SiteHealthSnapshot["redirects"]["top"];
}) {
  if (top.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold">Top redirects by hit count</div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="text-right">Hits</TableHead>
            <TableHead className="text-right">Last hit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {top.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs max-w-[24rem] truncate">
                {r.sourcePath}
              </TableCell>
              <TableCell className="font-mono text-xs max-w-[24rem] truncate">
                {r.targetPath}
              </TableCell>
              <TableCell className="text-right text-xs">
                {r.hitCount.toLocaleString()}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {r.lastHitAt
                  ? new Date(r.lastHitAt).toLocaleDateString("en-US", {
                      dateStyle: "medium",
                    })
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
