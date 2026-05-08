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
import { nebulaApi } from "@/lib/nebula-api";
import { ExternalLink, FileText, LayoutGrid } from "lucide-react";

const STAGE = LIFECYCLE_STAGES.find((s) => s.key === "define")!;

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function StageDefinePage() {
  const meQuery = useGetPortalMe();
  const reportsQuery = useQuery({
    queryKey: ["nebula-reports", 1],
    queryFn: () => nebulaApi.listReports(1, 5),
    staleTime: 60_000,
  });
  const workspacesQuery = useQuery({
    queryKey: ["nebula-workspaces"],
    queryFn: () => nebulaApi.listWorkspaces(),
    staleTime: 60_000,
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

  const reports = reportsQuery.data?.data ?? [];
  const workspaces = workspacesQuery.data?.data ?? [];
  const activeWorkspaces = workspaces.filter((w) => w.status === "active").slice(0, 4);

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <StageHeader
          stage={STAGE}
          description="Shape the strategy. Zenith holds the readiness picture — content, policy, AI usage — and Nebula is where envisioning sessions turn into a plan."
        />

        <StageSection
          title="Readiness and policy"
          app="Zenith"
          action={
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Integration pending
            </Badge>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <PlaceholderCard
              title="State of content"
              description="Top-level content health: coverage, freshness, ownership gaps."
            />
            <PlaceholderCard
              title="AI readiness"
              description="Where the organization sits on the AI maturity curve, with pillar-level scoring."
            />
            <PlaceholderCard
              title="Policy conformance"
              description="Conformance signal across published policies — what's adopted, what's drifting."
            />
            <PlaceholderCard
              title="Information architecture"
              description="Guidelines and the IA reference model your engagement is being measured against."
            />
          </div>
        </StageSection>

        <StageSection
          title="Envisioning workspaces"
          app="Nebula"
          action={
            <Link href="/workspaces">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a className="text-xs font-medium text-fuchsia-400 hover:text-fuchsia-300">
                All workspaces →
              </a>
            </Link>
          }
        >
          {workspacesQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : activeWorkspaces.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <LayoutGrid size={28} className="mx-auto mb-2 opacity-30" />
                No active workspaces yet. Your team will spin one up when an envisioning session kicks off.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeWorkspaces.map((w) => (
                <a
                  key={w.id}
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl border border-border bg-card p-4 flex flex-col gap-1 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`define-workspace-${w.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm group-hover:text-fuchsia-300 truncate">
                      {w.name}
                    </div>
                    <ExternalLink size={11} className="text-muted-foreground shrink-0 mt-1" />
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{w.code}</div>
                </a>
              ))}
            </div>
          )}
        </StageSection>

        <StageSection
          title="Completed envisioning reports"
          app="Nebula"
          action={
            <Link href="/reports">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a className="text-xs font-medium text-fuchsia-400 hover:text-fuchsia-300">
                All reports →
              </a>
            </Link>
          }
        >
          {reportsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : reports.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <FileText size={28} className="mx-auto mb-2 opacity-30" />
                Reports show up here once a Nebula session closes and the AI summary is generated.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.spaceId}>
                  <Link href={`/reports/${r.spaceId}`}>
                    {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                    <a
                      className="group block rounded-xl border border-border bg-card p-4 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-all"
                      data-testid={`define-report-${r.spaceId}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-sm font-medium group-hover:text-fuchsia-300 truncate">
                            {r.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono">{r.code}</span> · Closed {fmt(r.closedAt)}
                          </div>
                        </div>
                      </div>
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </StageSection>
      </main>
    </PortalShell>
  );
}
