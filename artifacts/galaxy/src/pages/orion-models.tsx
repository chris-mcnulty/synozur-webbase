import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { orionApi, type OrionModel } from "@/lib/orion-api";
import { AlertCircle, ClipboardList, ExternalLink } from "lucide-react";

const ORION_BASE = (import.meta.env.VITE_ORION_BASE_URL ?? "https://orion.synozur.com").replace(/\/$/, "");

function scoreColor(score?: number) {
  if (score === undefined) return "text-muted-foreground";
  if (score >= 4) return "text-emerald-400";
  if (score >= 3) return "text-amber-400";
  return "text-rose-400";
}

function ModelCard({ model }: { model: OrionModel }) {
  const href = `${ORION_BASE}/${model.slug}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`orion-model-${model.id}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 space-y-1">
          <div className="font-semibold text-base group-hover:text-violet-300 transition-colors leading-snug">
            {model.name}
          </div>
          {model.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{model.description}</p>
          )}
        </div>
        {model.avgScore != null && (
          <div className={`text-right shrink-0 ${scoreColor(model.avgScore)}`}>
            <div className="text-xl font-bold leading-none">{model.avgScore.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">avg score</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span>{model.dimensionCount} dimension{model.dimensionCount !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>{model.questionCount} question{model.questionCount !== 1 ? "s" : ""}</span>
      </div>

      <span
        className="mt-auto self-start inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 group-hover:text-violet-300 transition-colors"
        data-testid={`link-model-${model.id}`}
      >
        Take assessment <ExternalLink size={11} />
      </span>
    </a>
  );
}

export default function OrionModelsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orion-models"],
    queryFn: () => orionApi.getModels(),
    staleTime: 5 * 60_000,
  });

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assessments</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Maturity assessment models available to your organisation via Orion.
            </p>
          </div>
          {Array.isArray(data) && data.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {data.length} model{data.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="orion-models-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error instanceof Error ? error.message : "Could not load assessment data. Please try again later."}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        ) : !isError && (!Array.isArray(data) || data.length === 0) ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
              No assessment models available yet. Check back once Orion has published models for your domain.
            </CardContent>
          </Card>
        ) : Array.isArray(data) && (
          <div className="grid gap-4 sm:grid-cols-2" data-testid="orion-models-list">
            {data.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        )}
      </main>
    </PortalShell>
  );
}
