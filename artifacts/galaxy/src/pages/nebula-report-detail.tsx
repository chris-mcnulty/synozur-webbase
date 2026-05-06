import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nebulaApi } from "@/lib/nebula-api";
import { ExternalLink, ChevronDown, ChevronRight, AlertCircle, ArrowLeft, Lightbulb } from "lucide-react";

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Props { spaceId: string }

export default function NebulaReportDetailPage({ spaceId }: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["nebula-report", spaceId],
    queryFn: () => nebulaApi.getReport(spaceId),
    staleTime: 5 * 60_000,
    retry: (count, err) => {
      const s = (err as { status?: number }).status;
      if (s === 404 || s === 403 || s === 503) return false;
      return count < 2;
    },
  });

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const nebulaBaseUrl = (import.meta.env.VITE_NEBULA_BASE_URL as string | undefined) ?? "https://nebula.synozur.com";

  return (
    <PortalShell>
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <Link href="/reports">
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> All reports
          </a>
        </Link>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {(error as Error).message}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : data && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                  <span>Code: <span className="font-mono">{data.code}</span></span>
                  {data.closedAt && <span>Closed: {fmt(data.closedAt)}</span>}
                  {data.generatedAt && <span>Report generated: {fmt(data.generatedAt)}</span>}
                </div>
              </div>
              <a
                href={`${nebulaBaseUrl}/workspace/${data.code}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-fuchsia-400 hover:text-fuchsia-300 shrink-0"
                data-testid="link-open-in-nebula"
              >
                View in Nebula <ExternalLink size={13} />
              </a>
            </div>

            {/* Key themes */}
            {data.keyThemes && data.keyThemes.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Key themes</h2>
                <div className="flex flex-wrap gap-2">
                  {data.keyThemes.map((t) => (
                    <Badge key={t} variant="secondary" className="text-sm">{t}</Badge>
                  ))}
                </div>
              </section>
            )}

            {/* AI Summary */}
            {data.summary && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="font-semibold mb-2">Summary</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{data.summary}</p>
                </CardContent>
              </Card>
            )}

            {/* Top ideas */}
            {data.topIdeas && data.topIdeas.length > 0 && (
              <section>
                <h2 className="font-semibold mb-3 flex items-center gap-2">
                  <Lightbulb size={16} className="text-fuchsia-400" /> Top ideas
                </h2>
                <ol className="space-y-2">
                  {data.topIdeas.map((idea, i) => (
                    <li key={i} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                      <span className="text-xs font-mono text-muted-foreground w-5 shrink-0 mt-0.5">#{i + 1}</span>
                      <span className="flex-1 text-sm">{idea.content}</span>
                      <span className="text-xs text-fuchsia-400 font-semibold shrink-0">{Math.round(idea.score * 100)}%</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Insights */}
            {data.insights && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="font-semibold mb-2">Insights</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{data.insights}</p>
                </CardContent>
              </Card>
            )}

            {/* Recommendations */}
            {data.recommendations && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="font-semibold mb-2">Recommendations</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{data.recommendations}</p>
                </CardContent>
              </Card>
            )}

            {/* Category breakdown */}
            {data.categoryBreakdown && data.categoryBreakdown.length > 0 && (
              <section>
                <h2 className="font-semibold mb-3">Ideas by category</h2>
                <div className="space-y-2">
                  {data.categoryBreakdown.map((cat) => (
                    <div key={cat.id} className="rounded-xl border border-border bg-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleCat(cat.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                      >
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color ?? "#7C3AED" }}
                        />
                        <span className="flex-1 font-medium text-sm">{cat.name}</span>
                        <span className="text-xs text-muted-foreground">{cat.noteCount} idea{cat.noteCount !== 1 ? "s" : ""}</span>
                        {expandedCats.has(cat.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      {expandedCats.has(cat.id) && (
                        <ul className="border-t border-border divide-y divide-border">
                          {cat.notes.map((n) => (
                            <li key={n.id} className="px-5 py-2.5 text-sm text-muted-foreground">{n.content}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {data.uncategorisedNoteCount > 0 && (
                    <p className="text-xs text-muted-foreground px-1">
                      +{data.uncategorisedNoteCount} uncategorised idea{data.uncategorisedNoteCount !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              </section>
            )}

            <div className="pt-4 border-t border-border flex justify-end">
              <Button asChild variant="outline">
                <a href={`${nebulaBaseUrl}/workspace/${data.code}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} className="mr-1.5" /> Open in Nebula
                </a>
              </Button>
            </div>
          </>
        )}
      </main>
    </PortalShell>
  );
}
