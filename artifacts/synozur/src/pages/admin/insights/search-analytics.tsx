import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, MousePointerClick, AlertCircle, ListChecks, Save, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  fetchSearchAnalytics,
  fetchSearchKindBoosts,
  updateSearchKindBoosts,
  KIND_LABELS,
  SEARCH_KINDS,
  type SearchKind,
} from "@/lib/search-api";

// #170 — Editorial dashboard for the public search feature. Surfaces the
// signals that pair naturally with #134's "low retrieval confidence"
// report: which queries returned zero results (content gaps), which
// queries are most popular, and how often a result is clicked through
// (click-through rate as a proxy for relevance).

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon: typeof Search;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-3xl font-semibold mt-1">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
        <Icon className="h-8 w-8 text-muted-foreground/40" />
      </div>
    </Card>
  );
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function SearchAnalyticsPage() {
  const { access } = useAdminAccess();
  const qc = useQueryClient();
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "search-analytics", days],
    queryFn: () => fetchSearchAnalytics(days),
    enabled: !!access?.hasCmsRole,
    staleTime: 60_000,
  });

  // Per-kind ranking boosts: load current effective values, let editors
  // tweak each kind's multiplier, persist via PUT. Defaults come back from
  // the server so editors can always reset cleanly.
  const boostsQuery = useQuery({
    queryKey: ["admin", "search-kind-boosts"],
    queryFn: fetchSearchKindBoosts,
    enabled: !!access?.hasCmsRole,
    staleTime: 60_000,
  });
  const [boostDraft, setBoostDraft] = useState<Record<SearchKind, string> | null>(null);
  useEffect(() => {
    if (boostsQuery.data && !boostDraft) {
      const next: Record<SearchKind, string> = {} as Record<SearchKind, string>;
      for (const k of SEARCH_KINDS) next[k] = String(boostsQuery.data.boosts[k]);
      setBoostDraft(next);
    }
  }, [boostsQuery.data, boostDraft]);
  const saveBoosts = useMutation({
    mutationFn: async () => {
      if (!boostDraft) return;
      const numeric: Partial<Record<SearchKind, number>> = {};
      for (const k of SEARCH_KINDS) {
        const v = Number.parseFloat(boostDraft[k]);
        if (Number.isFinite(v) && v > 0) numeric[k] = v;
      }
      await updateSearchKindBoosts(numeric);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "search-kind-boosts"] });
    },
  });

  return (
    <AdminLayout
      title="Search analytics"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Insights", href: "/insights/posts" },
        { label: "Search analytics" },
      ]}
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Search analytics</h1>
          <p className="text-sm text-muted-foreground">
            What visitors are searching for on the public site, what's not
            being found, and which kinds get clicked.
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
          <SelectTrigger className="w-32" data-testid="search-analytics-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Couldn't load search analytics.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Total searches"
              value={data.totals.total.toLocaleString()}
              icon={Search}
            />
            <StatCard
              label="Click-through rate"
              value={formatPct(data.totals.clickThroughRate)}
              icon={MousePointerClick}
              hint={`${data.totals.clicked.toLocaleString()} clicks`}
            />
            <StatCard
              label="Zero-result rate"
              value={formatPct(data.totals.zeroResultRate)}
              icon={AlertCircle}
              hint={`${data.totals.zero.toLocaleString()} empty`}
            />
            <StatCard
              label="Distinct queries"
              value={data.topQueries.length.toLocaleString()}
              icon={ListChecks}
              hint="top 50 in window"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <h2 className="font-semibold mb-3">Top zero-result queries</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Searches that returned nothing — likely content gaps worth
                writing about.
              </p>
              {data.zeroResultQueries.length === 0 ? (
                <div className="text-sm text-muted-foreground">No zero-result queries in this window.</div>
              ) : (
                <ul className="space-y-1.5" data-testid="zero-result-list">
                  {data.zeroResultQueries.map((row) => (
                    <li
                      key={row.query}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-mono truncate pr-3">{row.query || "(empty)"}</span>
                      <span className="text-muted-foreground">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="font-semibold mb-3">Top queries</h2>
              <p className="text-xs text-muted-foreground mb-4">
                What visitors are searching for most often.
              </p>
              {data.topQueries.length === 0 ? (
                <div className="text-sm text-muted-foreground">No searches in this window.</div>
              ) : (
                <ul className="space-y-1.5" data-testid="top-queries-list">
                  {data.topQueries.slice(0, 25).map((row) => (
                    <li
                      key={row.query}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-mono truncate pr-3">{row.query || "(empty)"}</span>
                      <span className="text-muted-foreground">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="p-5 mt-6" data-testid="kind-boosts-editor">
            <div className="flex items-start justify-between mb-3 gap-4">
              <div>
                <h2 className="font-semibold">Per-kind ranking boosts</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Multipliers applied to each kind's relevance score —
                  raise to surface that kind higher on equal-match ties,
                  lower to demote. Values must be positive (max 10).
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!boostsQuery.data || saveBoosts.isPending}
                  onClick={() => {
                    if (!boostsQuery.data) return;
                    const reset: Record<SearchKind, string> = {} as Record<SearchKind, string>;
                    for (const k of SEARCH_KINDS) reset[k] = String(boostsQuery.data.defaults[k]);
                    setBoostDraft(reset);
                  }}
                  data-testid="boosts-reset"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset to defaults
                </Button>
                <Button
                  size="sm"
                  disabled={!boostDraft || saveBoosts.isPending}
                  onClick={() => saveBoosts.mutate()}
                  data-testid="boosts-save"
                >
                  <Save className="h-4 w-4 mr-1" />
                  {saveBoosts.isPending ? "Saving…" : "Save boosts"}
                </Button>
              </div>
            </div>
            {boostsQuery.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {boostDraft && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {SEARCH_KINDS.map((k) => (
                  <label
                    key={k}
                    className="flex items-center justify-between gap-3 border border-border/50 rounded-md px-3 py-2"
                  >
                    <span className="text-sm">{KIND_LABELS[k]}</span>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10"
                      value={boostDraft[k]}
                      onChange={(e) =>
                        setBoostDraft((prev) =>
                          prev ? { ...prev, [k]: e.target.value } : prev,
                        )
                      }
                      className="w-24 h-8"
                      data-testid={`boost-input-${k}`}
                    />
                  </label>
                ))}
              </div>
            )}
            {saveBoosts.isError && (
              <div className="mt-3 text-sm text-destructive">Couldn't save — try again.</div>
            )}
            {saveBoosts.isSuccess && !saveBoosts.isPending && (
              <div className="mt-3 text-sm text-muted-foreground">Boosts saved.</div>
            )}
          </Card>

          <Card className="p-5 mt-6">
            <h2 className="font-semibold mb-3">Top clicked kinds</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Which result kinds visitors actually click — useful when
              tuning the per-kind ranking boosts in Site Settings.
            </p>
            {data.topClickedKinds.length === 0 ? (
              <div className="text-sm text-muted-foreground">No clicks tracked in this window.</div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="top-kinds-list">
                {data.topClickedKinds.map((row) => (
                  <li
                    key={row.kind ?? "unknown"}
                    className="flex items-center justify-between border border-border/50 rounded-md px-3 py-2 text-sm"
                  >
                    <span>{row.kind ? KIND_LABELS[row.kind as SearchKind] : "Unknown"}</span>
                    <span className="text-muted-foreground">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </AdminLayout>
  );
}
