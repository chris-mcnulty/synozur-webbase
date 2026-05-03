import { Link } from "wouter";
import {
  useListPortalAppArtifacts,
  type PortalArtifactSummary,
  type PortalSourceApp,
  type PortalForbiddenReason,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NotCustomer from "./not-customer";
import { PortalShell } from "@/components/portal-shell";

// Per-application cockpit surface (`/apps/:sourceApp`). Lists every published
// artifact for the signed-in client's org under one app, ordered most-recent
// first. The visual shell stays consistent across all six apps; each app is
// distinguished by its accent color + copy via the SURFACE_META map below.

type SurfaceMeta = {
  name: string;
  tagline: string;
  emptyCopy: string;
};

const SURFACE_META: Record<PortalSourceApp, SurfaceMeta> = {
  vega: {
    name: "Vega",
    tagline: "Strategy snapshots and operating-rhythm artifacts.",
    emptyCopy:
      "Once your team locks a strategy snapshot inside Vega, it'll appear here.",
  },
  nebula: {
    name: "Nebula",
    tagline: "Workshop outcomes and discovery synthesis.",
    emptyCopy:
      "Workshop outcomes and discovery synthesis from Nebula will land here as your team publishes them.",
  },
  constellation: {
    name: "Constellation",
    tagline: "Engagement status, project navigation, executive views.",
    emptyCopy:
      "Project status reports and executive views from Constellation will appear here.",
  },
  orion: {
    name: "Orion",
    tagline: "Roadmaps, milestones, and delivery plans.",
    emptyCopy:
      "Roadmaps and delivery plans from Orion will appear here as your team publishes them.",
  },
  orbit: {
    name: "Orbit",
    tagline: "Go-to-market kits and market-intelligence briefs.",
    emptyCopy:
      "GTM kits and market briefs from Orbit will appear here as your team publishes them.",
  },
  zenith: {
    name: "Zenith",
    tagline: "Microsoft 365 governance posture and compliance reports.",
    emptyCopy:
      "Governance assessments and compliance reports from Zenith will appear here.",
  },
};

function ArtifactRow({ a }: { a: PortalArtifactSummary }) {
  return (
    <Link href={`/apps/${a.sourceApp}/${a.id}`}>
      <a
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        data-testid={`artifact-row-${a.id}`}
      >
        <Card className="hover-elevate">
          <CardContent className="p-4 flex items-start gap-4">
            {a.thumbnail ? (
              <img
                src={a.thumbnail}
                alt=""
                className="h-16 w-16 rounded-md object-cover bg-muted"
              />
            ) : (
              <div className="h-16 w-16 rounded-md bg-muted" />
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {a.artifactKind}
                </Badge>
                {a.publishedAt ? (
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.publishedAt).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
              <h3 className="text-sm font-semibold leading-tight">{a.title}</h3>
              {a.summary ? (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {a.summary}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </a>
    </Link>
  );
}

export default function AppSurfacePage({
  sourceApp,
}: {
  sourceApp: PortalSourceApp;
}) {
  const query = useListPortalAppArtifacts(sourceApp);
  const meta = SURFACE_META[sourceApp];

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = query.error as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();
  if (forbiddenReason) return <NotCustomer reason={forbiddenReason} />;

  const items = query.data?.items ?? [];
  const isLoading = query.isLoading;

  return (
    <PortalShell>
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div className="space-y-3">
          <Link href="/apps">
            <a className="text-xs text-muted-foreground hover:underline" data-testid="link-back-to-apps">
              ← All apps
            </a>
          </Link>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {sourceApp}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {meta.name}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {meta.tagline}
            </p>
          </div>
        </div>

        <section className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : items.length === 0 ? (
            <Card data-testid={`empty-state-${sourceApp}`}>
              <CardContent className="p-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {meta.emptyCopy}
                </p>
                <Link href="/apps">
                  <Button variant="outline" size="sm">
                    Back to all apps
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            items.map((a) => <ArtifactRow key={a.id} a={a} />)
          )}
        </section>
      </main>
    </PortalShell>
  );
}
