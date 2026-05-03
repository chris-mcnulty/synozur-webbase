import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";
import {
  useCmsGetSiteHealth,
  useCmsListPublishBlocks,
  useCmsScanPublishBlocks,
  useCmsResolvePublishBlock,
  getCmsListPublishBlocksQueryKey,
  type SiteHealthSnapshot,
  type SiteHealthCwvRow,
  type PublishBlock,
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

      <PublishBlocksCard />

      <AiPromptCacheCard
        data={snapshot.aiPromptCache}
        windowDays={snapshot.windowDays}
      />

      <AiChatUsageCard data={snapshot.aiChat} windowDays={snapshot.windowDays} />

      <CwvTable rows={snapshot.cwv} windowDays={snapshot.windowDays} />

      {snapshot.redirects.chains.length > 0 && (
        <RedirectsChainsCard chains={snapshot.redirects.chains} />
      )}

      <RedirectsTopCard top={snapshot.redirects.top} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI prompt-cache hit rate (#167)
// ---------------------------------------------------------------------------

function formatUsd(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs < 0.01 && abs > 0) return `${sign}<$0.01`;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function AiPromptCacheCard({
  data,
  windowDays,
}: {
  data: SiteHealthSnapshot["aiPromptCache"];
  windowDays: number;
}) {
  const alertTone =
    data.alert.severity === "page"
      ? "border-red-500/40 bg-red-500/5"
      : data.alert.severity === "ok"
        ? "border-emerald-500/30"
        : "border-border";
  const hitRateTone =
    data.latestHitRate >= 0.7
      ? "text-emerald-300"
      : data.latestHitRate >= data.thresholds.hitRate
        ? "text-amber-300"
        : "text-red-300";
  const savingsTone =
    data.estimatedSavingsUsd > 0 ? "text-emerald-300" : "text-amber-300";

  return (
    <Card className={`overflow-hidden ${alertTone}`}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-amber-300" />
            AI prompt-cache hit rate · last {windowDays}d
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Anthropic ephemeral prompt caching reuses the grounding
            system block + prior conversation inside its 5-minute TTL.
            Pager fires when the most recent fully-elapsed UTC day's
            hit rate drops below {Math.round(data.thresholds.hitRate * 100)}%
            over at least {data.thresholds.minRequests} requests.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-b border-border">
        <div className="p-4 md:border-r border-border">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Latest complete day
          </div>
          <div className={`mt-2 text-3xl font-semibold ${hitRateTone}`}>
            {data.latestComplete
              ? `${Math.round(data.latestHitRate * 100)}%`
              : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.latestComplete
              ? `${data.latestComplete} · ${data.latestRequestCount} request${data.latestRequestCount === 1 ? "" : "s"}`
              : "No fully-elapsed UTC day yet."}
          </div>
        </div>
        <div className="p-4 md:border-r border-border">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Estimated savings · {windowDays}d
          </div>
          <div className={`mt-2 text-3xl font-semibold ${savingsTone}`}>
            {formatUsd(data.estimatedSavingsUsd)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            vs. running uncached at standard input rates.
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Alert
          </div>
          <div className="mt-2 text-sm">
            {data.alert.severity === "page" && (
              <span className="inline-flex items-center gap-1 text-red-300 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Page on-call
              </span>
            )}
            {data.alert.severity === "ok" && (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Healthy
              </span>
            )}
            {data.alert.severity === "insufficient-data" && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                Insufficient data
              </span>
            )}
          </div>
          {data.alert.message && (
            <div className="mt-1 text-xs text-red-200/80">
              {data.alert.message}
            </div>
          )}
        </div>
      </div>

      {data.daily.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No /ai/chat traffic in the last {windowDays} day
          {windowDays === 1 ? "" : "s"} yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>UTC day</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Warm</TableHead>
              <TableHead className="text-right">Hit rate</TableHead>
              <TableHead className="text-right">Cache reads</TableHead>
              <TableHead className="text-right">Cache writes</TableHead>
              <TableHead className="text-right">Savings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.daily.map((d) => {
              const tone =
                d.hitRate >= 0.7
                  ? "text-emerald-300"
                  : d.hitRate >= data.thresholds.hitRate
                    ? "text-amber-300"
                    : "text-red-300";
              const savingsToneRow =
                d.estimatedSavingsUsd > 0
                  ? "text-emerald-300"
                  : "text-amber-300";
              return (
                <TableRow key={`${d.utcDay}:${d.model}`}>
                  <TableCell className="font-mono text-xs">
                    {d.utcDay}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {d.model}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {d.requestCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {d.warmRequestCount.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={`text-right text-xs font-medium ${tone}`}
                  >
                    {Math.round(d.hitRate * 100)}%
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {d.cacheReadInputTokens.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {d.cacheCreationInputTokens.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={`text-right text-xs ${savingsToneRow}`}
                  >
                    {formatUsd(d.estimatedSavingsUsd)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AI chat token spend (#166). Bar-style chart of input+output tokens per
// day with a horizontal reference line at the configured global cap, plus
// today's spend vs caps.
// ---------------------------------------------------------------------------

function AiChatUsageCard({
  data,
  windowDays,
}: {
  data: SiteHealthSnapshot["aiChat"];
  windowDays: number;
}) {
  const todayTotal = data.today.inputTokens + data.today.outputTokens;
  const cap = data.dailyCapGlobal;
  const pct = cap > 0 ? Math.min(100, (todayTotal / cap) * 100) : 0;
  const peak = Math.max(
    cap,
    ...data.days.map((d) => d.inputTokens + d.outputTokens),
    1,
  );
  const fmt = (n: number) => n.toLocaleString();

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          AI chat token spend ({windowDays === 1 ? "last 24h" : `last ${windowDays} days`})
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Daily totals across all sessions and IPs. Chart sums input + output tokens per UTC day.
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-muted-foreground">Today</div>
            <div className="text-lg font-semibold mt-1">{fmt(todayTotal)} tokens</div>
            <div className="text-muted-foreground mt-0.5">
              {fmt(data.today.callCount)} calls · {pct.toFixed(1)}% of global cap
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Per-session daily cap</div>
            <div className="text-lg font-semibold mt-1">{fmt(data.dailyCapPerSession)}</div>
            <div className="text-muted-foreground mt-0.5">tokens / session / day</div>
          </div>
          <div>
            <div className="text-muted-foreground">Global daily cap</div>
            <div className="text-lg font-semibold mt-1">{fmt(data.dailyCapGlobal)}</div>
            <div className="text-muted-foreground mt-0.5">tokens / day across the fleet</div>
          </div>
        </div>
        {data.days.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No AI chat usage recorded in this window.
          </div>
        ) : (
          <div className="space-y-1">
            {data.days.map((d) => {
              const total = d.inputTokens + d.outputTokens;
              const widthPct = peak > 0 ? (total / peak) * 100 : 0;
              const overCap = cap > 0 && total >= cap;
              return (
                <div
                  key={d.day}
                  className="flex items-center gap-3 text-xs"
                  data-testid={`row-ai-chat-usage-${d.day}`}
                >
                  <div className="w-20 text-muted-foreground tabular-nums">{d.day}</div>
                  <div className="flex-1 bg-muted/40 rounded h-4 relative overflow-hidden">
                    <div
                      className={`h-full ${overCap ? "bg-destructive/60" : "bg-cyan-500/60"}`}
                      style={{ width: `${widthPct}%` }}
                    />
                    {cap > 0 && cap < peak && (
                      <div
                        className="absolute top-0 bottom-0 border-l border-amber-400/70"
                        style={{ left: `${(cap / peak) * 100}%` }}
                        title="Global cap"
                      />
                    )}
                  </div>
                  <div className="w-32 text-right tabular-nums">
                    {fmt(total)}
                    <span className="text-muted-foreground ml-1">/ {fmt(d.callCount)}c</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Publish blocks (#142 Phase D)
// ---------------------------------------------------------------------------

function PublishBlocksCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const blocksQ = useCmsListPublishBlocks();
  const blocks: PublishBlock[] = blocksQ.data?.items ?? [];

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getCmsListPublishBlocksQueryKey() });

  const scanMut = useCmsScanPublishBlocks({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast({
          title: "Scan complete",
          description: `${result.inserted} new, ${result.retained} retained, ${result.autoResolved} auto-resolved.`,
        });
      },
      onError: (e: Error) =>
        toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
    },
  });

  const resolveMut = useCmsResolvePublishBlock({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Block resolved" });
      },
      onError: (e: Error) =>
        toast({ title: "Resolve failed", description: e.message, variant: "destructive" }),
    },
  });

  const [resolving, setResolving] = useState<PublishBlock | null>(null);
  const [note, setNote] = useState("");

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
            Publish blocks ({blocks.length})
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Warn-mode v0 — surfaced on edit pages for editor attention. The
            publish mutations don't reject on these yet; the hard-reject
            flip is a follow-up once the inherited backlog is cleared.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => scanMut.mutate()}
          disabled={scanMut.isPending}
          data-testid="button-scan-publish-blocks"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${scanMut.isPending ? "animate-spin" : ""}`} />
          Run scan
        </Button>
      </div>
      {blocksQ.isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : blocks.length === 0 ? (
        <div className="p-6 text-center text-sm text-emerald-300">
          <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
          No active publish blocks.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Artifact</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>First seen</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.sourceRule}</TableCell>
                <TableCell className="font-mono text-xs max-w-[16rem] truncate">
                  {b.artifactKind}
                  {b.artifactId ? `:${b.artifactId}` : ""}
                </TableCell>
                <TableCell className="text-xs">{b.reason}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(b.createdAt).toLocaleDateString("en-US", {
                    dateStyle: "medium",
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setResolving(b);
                      setNote("");
                    }}
                    data-testid={`button-resolve-block-${b.id}`}
                  >
                    Override…
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={!!resolving}
        onOpenChange={(open) => !open && setResolving(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override publish block</DialogTitle>
          </DialogHeader>
          {resolving && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{resolving.sourceRule}</span> —{" "}
                {resolving.reason}
              </div>
              <div>
                <Label htmlFor="resolution-note">Resolution note (required)</Label>
                <Textarea
                  id="resolution-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  placeholder="Why is it OK to ignore this block? This goes in the audit log."
                  data-testid="textarea-resolution-note"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              disabled={!note.trim() || resolveMut.isPending}
              onClick={() => {
                if (!resolving) return;
                resolveMut.mutate(
                  { id: resolving.id, data: { resolutionNote: note.trim() } },
                  {
                    onSuccess: () => {
                      setResolving(null);
                      setNote("");
                    },
                  },
                );
              }}
              data-testid="button-confirm-resolve-block"
            >
              Resolve with note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
