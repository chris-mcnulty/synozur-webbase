import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { useAdminAccess } from "@/components/admin/AdminGate";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
function apiUrl(path: string) {
  return `${BASE_PATH}/api${path.startsWith("/") ? path : `/${path}`}`;
}
import { Link } from "wouter";
import { RefreshCw, AlertTriangle, Sparkles, PenSquare } from "lucide-react";

// Build a deep link into the new-post composer that pre-fills a draft
// title from a visitor's question. The Insights composer reads the
// `?title=` and `?prompt=` query params on mount.
function newInsightHref(question: string): string {
  const params = new URLSearchParams({
    title: question.slice(0, 200),
    prompt: question.slice(0, 1000),
    source: "ask-synozur",
  });
  return `/admin/insights/new?${params.toString()}`;
}

interface Source {
  kind: string;
  id: string;
  title: string;
  url: string;
  score?: number;
}

interface QuestionRow {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  model: string | null;
  refused: boolean;
  lowConfidence: boolean;
  sourceCount: number;
  topScore: number | null;
  clickThroughCount: number;
  createdAt: string;
}

interface SummaryResponse {
  since: string;
  agg: {
    total: number;
    refused: number;
    low_confidence: number;
    click_throughs: number;
  };
  top: { question: string; count: number }[];
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function AdminInsightsQuestions() {
  const { access, isLoading: accessLoading } = useAdminAccess();
  const canView = !!access?.hasCapability("content.moderate");
  const canRebuild = !!access?.hasCapability("ai.grounding.manage");
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<"all" | "low_confidence" | "refused">(
    "all",
  );
  const qc = useQueryClient();

  const summary = useQuery({
    queryKey: ["insights-questions-summary", days],
    queryFn: () =>
      fetchJson<SummaryResponse>(
        `/cms/insights/questions/summary?sinceDays=${days}`,
      ),
    enabled: canView,
  });
  const list = useQuery({
    queryKey: ["insights-questions-list", days],
    queryFn: () =>
      fetchJson<{ items: QuestionRow[] }>(
        `/cms/insights/questions?sinceDays=${days}&limit=200`,
      ),
    enabled: canView,
  });

  const rebuild = useMutation({
    mutationFn: () =>
      fetchJson<{ ok: true; sources: number; chunks: number; removed: number }>(
        "/ai/editorial-index/rebuild",
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insights-questions-summary"] });
    },
  });

  useEffect(() => {
    document.title = "Ask Synozur · Questions";
  }, []);

  if (accessLoading) {
    return (
      <AdminLayout
        title="Ask Synozur — Questions"
        crumbs={[{ label: "Insights" }, { label: "Questions" }]}
      >
        <div className="text-sm text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }
  if (!canView) {
    return (
      <AdminLayout
        title="Ask Synozur — Questions"
        crumbs={[{ label: "Insights" }, { label: "Questions" }]}
      >
        <div className="rounded-md border bg-muted/40 p-6">
          You need the <code>content.moderate</code> capability to view
          question telemetry.
        </div>
      </AdminLayout>
    );
  }

  const agg = summary.data?.agg;
  const top = summary.data?.top ?? [];
  const refusalRate =
    agg && agg.total > 0 ? Math.round((agg.refused / agg.total) * 100) : 0;
  const lowConfRate =
    agg && agg.total > 0
      ? Math.round((agg.low_confidence / agg.total) * 100)
      : 0;

  return (
    <AdminLayout
      title="Ask Synozur — Questions"
      crumbs={[{ label: "Insights" }, { label: "Questions" }]}
      actions={
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            data-testid="select-window"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <select
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as "all" | "low_confidence" | "refused")
            }
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            data-testid="select-filter"
          >
            <option value="all">All questions</option>
            <option value="low_confidence">Low confidence only</option>
            <option value="refused">Refused only</option>
          </select>
          {canRebuild && (
            <Button
              variant="outline"
              onClick={() => rebuild.mutate()}
              disabled={rebuild.isPending}
              data-testid="button-rebuild-index"
            >
              <RefreshCw
                className={`h-4 w-4 ${rebuild.isPending ? "animate-spin" : ""}`}
              />
              <span className="ml-2">
                {rebuild.isPending ? "Rebuilding…" : "Rebuild corpus"}
              </span>
            </Button>
          )}
        </div>
      }
    >
      {rebuild.data && (
        <div
          className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950"
          data-testid="text-rebuild-result"
        >
          Indexed {rebuild.data.chunks} chunks across {rebuild.data.sources}{" "}
          sources (pruned {rebuild.data.removed} stale chunks).
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-4" data-testid="block-summary">
        <Stat label="Questions" value={agg?.total ?? 0} />
        <Stat label="Refusal rate" value={`${refusalRate}%`} hint={`${agg?.refused ?? 0} refused`} />
        <Stat label="Low-confidence rate" value={`${lowConfRate}%`} hint={`${agg?.low_confidence ?? 0} low-conf`} />
        <Stat label="Citation clicks" value={agg?.click_throughs ?? 0} />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Top questions</h2>
        {top.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ol className="mt-3 space-y-1 text-sm" data-testid="list-top-questions">
            {top.map((row) => (
              <li
                key={row.question}
                className="flex items-baseline justify-between gap-3 border-b py-1.5"
              >
                <span className="flex-1 truncate">{row.question}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.count}
                  </span>
                  <Link
                    href={newInsightHref(row.question)}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    data-testid={`link-create-insight-${row.question.length}`}
                  >
                    <PenSquare className="h-3 w-3" />
                    Create insight
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          {filter === "low_confidence"
            ? "Low-confidence questions"
            : filter === "refused"
              ? "Refused questions"
              : "Recent activity"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {filter === "all"
            ? "All recent questions in the selected window."
            : "These are gaps in the corpus — consider publishing an insight on the topic."}
        </p>
        {(() => {
          const items = list.data?.items ?? [];
          const filtered =
            filter === "low_confidence"
              ? items.filter((r) => r.lowConfidence && !r.refused)
              : filter === "refused"
                ? items.filter((r) => r.refused)
                : items;
          if (list.isLoading) {
            return (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            );
          }
          if (filtered.length === 0) {
            return (
              <p className="mt-2 text-sm text-muted-foreground">
                No questions in this view.
              </p>
            );
          }
          return (
            <ul className="mt-3 space-y-3" data-testid="list-recent-questions">
              {filtered.map((row) => (
              <li
                key={row.id}
                className="rounded-md border p-3"
                data-testid={`row-question-${row.id}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <time>{new Date(row.createdAt).toLocaleString()}</time>
                  {row.refused && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      Refused
                    </span>
                  )}
                  {!row.refused && row.lowConfidence && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                      Low confidence
                    </span>
                  )}
                  {row.model && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                      <Sparkles className="h-3 w-3" />
                      {row.model}
                    </span>
                  )}
                  <span>{row.sourceCount} sources</span>
                  {row.clickThroughCount > 0 && (
                    <span>{row.clickThroughCount} clicks</span>
                  )}
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="font-medium">{row.question}</p>
                  {(row.refused || row.lowConfidence) && (
                    <Link
                      href={newInsightHref(row.question)}
                      className="inline-flex flex-none items-center gap-1 rounded-md border px-2 py-1 text-xs text-primary hover:bg-muted"
                      data-testid={`link-create-insight-row-${row.id}`}
                    >
                      <PenSquare className="h-3 w-3" />
                      Create insight on this topic
                    </Link>
                  )}
                </div>
                {row.answer && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      Show answer
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-sm">
                      {row.answer}
                    </pre>
                  </details>
                )}
                {row.sources.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {row.sources.map((s, i) => (
                      <li
                        key={`${row.id}-${i}`}
                        className="rounded-full border px-2 py-0.5"
                      >
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          [{i + 1}] {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              ))}
            </ul>
          );
        })()}
      </section>
    </AdminLayout>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
