import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nebulaApi } from "@/lib/nebula-api";
import { ChevronLeft, ChevronRight, FileText, AlertCircle } from "lucide-react";

const PAGE_SIZE = 20;

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function NebulaReportsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["nebula-reports", page],
    queryFn: () => nebulaApi.listReports(page, PAGE_SIZE),
    staleTime: 60_000,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Envisioning Reports</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Completed cohort reports from your Nebula sessions.
            </p>
          </div>
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.total} report{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="nebula-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {(error as Error).message}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : !isError && (!data || data.data.length === 0) ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <FileText size={32} className="mx-auto mb-3 opacity-30" />
              No completed reports yet. Reports appear here once a Nebula session is closed and the AI report is generated.
            </CardContent>
          </Card>
        ) : data && (
          <>
            <ul className="space-y-3" data-testid="nebula-reports-list">
              {data.data.map((r) => (
                <li key={r.spaceId}>
                  <Link href={`/reports/${r.spaceId}`}>
                    {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                    <a className="group block rounded-xl border border-border bg-card p-5 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-all" data-testid={`report-${r.spaceId}`}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="space-y-1 min-w-0">
                          <div className="font-semibold text-base group-hover:text-fuchsia-300 transition-colors">{r.name}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span>Code: <span className="font-mono">{r.code}</span></span>
                            <span>Closed: {fmt(r.closedAt)}</span>
                            <span>Report: {fmt(r.reportGeneratedAt)}</span>
                          </div>
                          {r.summarySnippet && (
                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.summarySnippet}</p>
                          )}
                        </div>
                        <Badge variant="secondary" className="shrink-0">View report →</Badge>
                      </div>
                    </a>
                  </Link>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={14} />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </PortalShell>
  );
}
