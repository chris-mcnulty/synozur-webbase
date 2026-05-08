import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetPortalMe,
  useListPortalEngagements,
  type PortalForbiddenReason,
  type PortalEngagement,
} from "@workspace/api-client-react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LIFECYCLE_STAGES, StageHeader, StageSection } from "@/components/lifecycle";
import NotCustomer from "./not-customer";
import { constellationApi, type CProject } from "@/lib/constellation-api";
import {
  healthColor,
  healthLabel,
  projectStatusVariant,
} from "@/lib/constellation-presentation";
import { AlertCircle, FolderOpen } from "lucide-react";

const STAGE = LIFECYCLE_STAGES.find((s) => s.key === "deliver")!;

const ENGAGEMENT_STATUS_LABEL: Record<PortalEngagement["status"], string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

function ProjectCard({ project }: { project: CProject }) {
  return (
    <Link href={`/projects/${project.id}`}>
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
      <a
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
        data-testid={`deliver-project-${project.id}`}
      >
        <div className="group rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {project.code ? (
                  <span className="text-xs font-mono text-muted-foreground">
                    {project.code}
                  </span>
                ) : null}
                <Badge variant={projectStatusVariant(project.status)} className="text-xs capitalize">
                  {project.status}
                </Badge>
              </div>
              <div className="font-semibold text-base group-hover:text-violet-300 leading-snug">
                {project.name}
              </div>
              {project.pmName ? (
                <p className="text-xs text-muted-foreground">PM: {project.pmName}</p>
              ) : null}
            </div>
            {project.healthStatus ? (
              <div className={`text-right shrink-0 ${healthColor(project.healthStatus)}`}>
                <div className="text-sm font-semibold">{healthLabel(project.healthStatus)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">health</div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            {project.startDate ? (
              <span>Started {new Date(project.startDate).toLocaleDateString()}</span>
            ) : null}
            {project.startDate && project.endDate ? <span>·</span> : null}
            {project.endDate ? (
              <span>Due {new Date(project.endDate).toLocaleDateString()}</span>
            ) : null}
          </div>
        </div>
      </a>
    </Link>
  );
}

function EngagementSummary({ engagement }: { engagement: PortalEngagement }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium truncate">{engagement.title}</div>
        {engagement.summary ? (
          <p className="text-xs text-muted-foreground line-clamp-2">{engagement.summary}</p>
        ) : null}
      </div>
      <Badge
        variant={engagement.status === "active" ? "default" : "secondary"}
        className="shrink-0"
      >
        {ENGAGEMENT_STATUS_LABEL[engagement.status]}
      </Badge>
    </div>
  );
}

export default function StageDeliverPage() {
  const meQuery = useGetPortalMe();
  const engagementsQuery = useListPortalEngagements();
  const projectsQuery = useQuery({
    queryKey: ["constellation-projects"],
    queryFn: () => constellationApi.listProjects({ limit: 100 }),
    staleTime: 90_000,
  });

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = (meQuery.error ?? engagementsQuery.error) as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();
  if (forbiddenReason) return <NotCustomer reason={forbiddenReason} />;

  const engagements = engagementsQuery.data?.items ?? [];
  const projects = projectsQuery.data?.items ?? [];

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <StageHeader
          stage={STAGE}
          description="Where strategy turns into delivery. Engagements anchor the work and Constellation tracks every project artifact, milestone, and status check."
        />

        <StageSection title="Active engagements">
          {engagementsQuery.isError ? (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {engagementsQuery.error instanceof Error
                ? engagementsQuery.error.message
                : "Could not load engagements."}
            </div>
          ) : engagementsQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : engagements.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No engagements yet. When your Synozur team kicks one off, you'll see it here.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {engagements.map((e) => (
                <EngagementSummary key={e.id} engagement={e} />
              ))}
            </div>
          )}
        </StageSection>

        <StageSection
          title="Projects"
          app="Constellation"
          action={
            !projectsQuery.isLoading && projects.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
            ) : null
          }
        >
          {projectsQuery.isError ? (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {projectsQuery.error instanceof Error
                ? projectsQuery.error.message
                : "Could not load project data."}
            </div>
          ) : projectsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : projects.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <FolderOpen size={32} className="mx-auto mb-3 opacity-30" />
                No projects yet — they'll show up here once Constellation kicks off delivery.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </StageSection>
      </main>
    </PortalShell>
  );
}
