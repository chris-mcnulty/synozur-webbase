import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useGetPortalMe, type PortalForbiddenReason } from "@workspace/api-client-react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  LIFECYCLE_STAGES,
  PlaceholderCard,
  StageHeader,
  StageSection,
} from "@/components/lifecycle";
import NotCustomer from "./not-customer";
import { orionApi, type OrionModel, type OrionResultEntry } from "@/lib/orion-api";
import { ExternalLink, ClipboardList, BarChart3 } from "lucide-react";

const ORION_BASE = (import.meta.env.VITE_ORION_BASE_URL ?? "https://orion.synozur.com").replace(/\/$/, "");
const STAGE = LIFECYCLE_STAGES.find((s) => s.key === "assess")!;

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 4) return "text-emerald-400";
  if (score >= 3) return "text-amber-400";
  return "text-rose-400";
}

function ModelTile({ model }: { model: OrionModel }) {
  return (
    <a
      href={`${ORION_BASE}/${model.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-xl border border-border bg-card p-4 flex flex-col gap-2 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`assess-model-${model.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-semibold text-sm group-hover:text-violet-300 transition-colors leading-snug min-w-0">
          {model.name}
        </div>
        {model.avgScore != null ? (
          <div className={`text-right shrink-0 ${scoreColor(model.avgScore)}`}>
            <div className="text-base font-bold leading-none">
              {model.avgScore.toFixed(1)}
            </div>
          </div>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {model.dimensionCount} dimension{model.dimensionCount !== 1 ? "s" : ""} ·{" "}
        {model.questionCount} question{model.questionCount !== 1 ? "s" : ""}
      </div>
      <span className="mt-auto self-start inline-flex items-center gap-1 text-xs font-medium text-violet-400 group-hover:text-violet-300">
        Take assessment <ExternalLink size={11} />
      </span>
    </a>
  );
}

function ResultRow({ entry }: { entry: OrionResultEntry }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium truncate">{entry.modelName}</div>
        <div className="text-xs text-muted-foreground">
          {(entry.responseCount ?? 0).toLocaleString()} response
          {(entry.responseCount ?? 0) !== 1 ? "s" : ""}
        </div>
      </div>
      <div className={`text-right shrink-0 ${scoreColor(entry.avgScore)}`}>
        <div className="text-lg font-bold leading-none">
          {entry.avgScore != null ? entry.avgScore.toFixed(2) : "—"}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">avg / 5</div>
      </div>
    </div>
  );
}

export default function StageAssessPage() {
  const meQuery = useGetPortalMe();
  const modelsQuery = useQuery({
    queryKey: ["orion-models"],
    queryFn: () => orionApi.getModels(),
    staleTime: 5 * 60_000,
  });
  const resultsQuery = useQuery({
    queryKey: ["orion-results"],
    queryFn: () => orionApi.getResults(),
    staleTime: 5 * 60_000,
  });

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = meQuery.error as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();
  if (forbiddenReason) return <NotCustomer reason={forbiddenReason} />;

  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const results = Array.isArray(resultsQuery.data) ? resultsQuery.data : [];
  const featuredModels = models.slice(0, 4);
  const topResults = results.slice(0, 3);

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <StageHeader
          stage={STAGE}
          description="Establish the starting line. Orbit captures the market context and Orion measures organizational maturity."
        />

        <StageSection
          title="Market context"
          app="Orbit"
          action={
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Integration pending
            </Badge>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <PlaceholderCard
              title="Baseline company overview"
              description="High-level market positioning derived from Orbit's dashboard, mapped to your organization or the chosen baseline."
            />
            <PlaceholderCard
              title="Competitive analysis"
              description="The latest competitive landscape — peers, threats, and where Synozur sees daylight."
            />
            <PlaceholderCard
              title="Market intelligence reports"
              description="Quarterly market signal reports curated for your engagement."
            />
          </div>
        </StageSection>

        <StageSection
          title="Maturity assessments"
          app="Orion"
          action={
            <Link href="/assessments">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a className="text-xs font-medium text-violet-400 hover:text-violet-300">
                All assessments →
              </a>
            </Link>
          }
        >
          {modelsQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : featuredModels.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
                No assessment models published for your organization yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {featuredModels.map((m) => (
                <ModelTile key={m.id} model={m} />
              ))}
            </div>
          )}
        </StageSection>

        <StageSection
          title="History and benchmarks"
          app="Orion"
          action={
            <Link href="/benchmarks">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a className="text-xs font-medium text-violet-400 hover:text-violet-300">
                Full benchmarks →
              </a>
            </Link>
          }
        >
          {resultsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : topResults.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <BarChart3 size={28} className="mx-auto mb-2 opacity-30" />
                Aggregate scores appear here once assessments have been completed.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {topResults.map((r) => (
                <ResultRow key={r.modelId} entry={r} />
              ))}
            </div>
          )}
        </StageSection>
      </main>
    </PortalShell>
  );
}
