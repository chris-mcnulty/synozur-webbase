import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { orionApi, type OrionResultEntry, type OrionScoreDistributionEntry } from "@/lib/orion-api";
import { AlertCircle, BarChart3 } from "lucide-react";

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 4) return "text-emerald-400";
  if (score >= 3) return "text-amber-400";
  return "text-rose-400";
}

function DistributionBar({ entry }: { entry: OrionScoreDistributionEntry }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground text-xs truncate">{entry.level}</span>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full bg-violet-500 transition-all"
          style={{ width: `${Math.min(100, entry.percentage ?? 0)}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs text-muted-foreground shrink-0">
        {(entry.percentage ?? 0).toFixed(0)}%
      </span>
      <span className="w-8 text-right text-xs text-muted-foreground shrink-0">
        {entry.count}
      </span>
    </div>
  );
}

function ResultCard({ entry }: { entry: OrionResultEntry }) {
  return (
    <Card data-testid={`orion-result-${entry.modelId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-semibold leading-snug">{entry.modelName}</CardTitle>
          <div className={`text-right shrink-0 ${scoreColor(entry.avgScore)}`}>
            <div className="text-2xl font-bold leading-none">
              {entry.avgScore != null ? entry.avgScore.toFixed(2) : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">avg / 5</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on {(entry.responseCount ?? 0).toLocaleString()} response{(entry.responseCount ?? 0) !== 1 ? "s" : ""}
        </p>
      </CardHeader>

      {(entry.scoreDistribution ?? []).length > 0 && (
        <CardContent className="space-y-2 pt-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 px-0">
            <span>Score distribution</span>
            <div className="flex gap-3">
              <span className="w-8 text-right">%</span>
              <span className="w-8 text-right">n</span>
            </div>
          </div>
          {(entry.scoreDistribution ?? []).map((d) => (
            <DistributionBar key={d.level} entry={d} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export default function OrionResultsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orion-results"],
    queryFn: () => orionApi.getResults(),
    staleTime: 5 * 60_000,
  });

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Benchmarks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Anonymized aggregate maturity scores across your organization's assessments.
            </p>
          </div>
          {Array.isArray(data) && data.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {data.length} model{data.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="orion-results-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error instanceof Error ? error.message : "Could not load benchmark data. Please try again later."}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full rounded-xl" />
            ))}
          </div>
        ) : !isError && (!Array.isArray(data) || data.length === 0) ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <BarChart3 size={32} className="mx-auto mb-3 opacity-30" />
              No benchmark data available yet. Results appear once assessments have been completed.
            </CardContent>
          </Card>
        ) : Array.isArray(data) && (
          <div className="space-y-4" data-testid="orion-results-list">
            {data.map((entry) => (
              <ResultCard key={entry.modelId} entry={entry} />
            ))}
          </div>
        )}
      </main>
    </PortalShell>
  );
}
