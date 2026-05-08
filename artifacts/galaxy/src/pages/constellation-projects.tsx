import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, FolderOpen } from "lucide-react";
import { constellationApi, type CProject } from "@/lib/constellation-api";
import {
  healthColor,
  healthLabel,
  projectStatusVariant,
} from "@/lib/constellation-presentation";

function ProjectCard({ project }: { project: CProject }) {
  return (
    <Link href={`/projects/${project.id}`}>
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
      <a className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
        <div className="group rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all cursor-pointer">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {project.code && (
                  <span className="text-xs font-mono text-muted-foreground">{project.code}</span>
                )}
                <Badge variant={projectStatusVariant(project.status)} className="text-xs capitalize">
                  {project.status}
                </Badge>
              </div>
              <div className="font-semibold text-base group-hover:text-violet-300 transition-colors leading-snug">
                {project.name}
              </div>
              {project.pmName && (
                <p className="text-xs text-muted-foreground">PM: {project.pmName}</p>
              )}
            </div>
            {project.healthStatus && (
              <div className={`text-right shrink-0 ${healthColor(project.healthStatus)}`}>
                <div className="text-sm font-semibold">{healthLabel(project.healthStatus)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">health</div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            {project.startDate && (
              <span>Started {new Date(project.startDate).toLocaleDateString()}</span>
            )}
            {project.startDate && project.endDate && <span>·</span>}
            {project.endDate && (
              <span>Due {new Date(project.endDate).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      </a>
    </Link>
  );
}

export default function ConstellationProjectsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["constellation-projects"],
    queryFn: () => constellationApi.listProjects({ limit: 100 }),
    staleTime: 90_000,
  });

  const items = data?.items ?? [];

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Constellation</p>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live project status and delivery tracking for your engagement.
            </p>
          </div>
          {!isLoading && !isError && items.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {items.length} project{items.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="constellation-projects-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error instanceof Error ? error.message : "Could not load project data. Please try again later."}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : !isError && items.length === 0 ? (
          <Card data-testid="constellation-projects-empty">
            <CardContent className="p-8 text-center text-muted-foreground">
              <FolderOpen size={32} className="mx-auto mb-3 opacity-30" />
              No projects found. Your engagement team will add projects once work is under way.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="constellation-projects-list">
            {items.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </main>
    </PortalShell>
  );
}
