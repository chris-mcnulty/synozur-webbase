import { Link } from "wouter";
import {
  useGetPortalArtifact,
  type PortalForbiddenReason,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import NotCustomer from "./not-customer";
import NotFound from "./not-found";
import { PortalShell } from "@/components/portal-shell";

// /apps/:sourceApp/:id — artifact detail. Server records a portal.artifact_view
// telemetry event on this fetch. Payload renders as a generic key/value list
// today; richer kind-specific renderers come later.

export default function ArtifactDetailPage({
  sourceApp,
  id,
}: {
  sourceApp: string;
  id: string;
}) {
  const query = useGetPortalArtifact(id);

  const err = query.error as
    | { status?: number; data?: { reason?: PortalForbiddenReason } }
    | null
    | undefined;
  if (err?.status === 403 && err.data?.reason) {
    return <NotCustomer reason={err.data.reason} />;
  }
  if (err?.status === 404) return <NotFound />;

  const a = query.data;
  const isLoading = query.isLoading;

  return (
    <PortalShell>
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <Link href={`/apps/${sourceApp}`}>
          <a className="text-xs text-muted-foreground hover:underline" data-testid="link-back-to-app">
            ← Back to {sourceApp}
          </a>
        </Link>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : a ? (
          <Card>
            <CardContent className="p-8 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {a.sourceApp}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {a.artifactKind}
                  </Badge>
                  {a.publishedAt ? (
                    <span className="text-xs text-muted-foreground">
                      Published {new Date(a.publishedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                <h1 className="text-2xl font-semibold leading-tight">
                  {a.title}
                </h1>
                {a.summary ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {a.summary}
                  </p>
                ) : null}
              </div>

              {a.externalUrl ? (
                <Button asChild variant="default" size="sm">
                  <a
                    href={a.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="link-external"
                  >
                    Open external resource
                  </a>
                </Button>
              ) : null}

              {a.payload && typeof a.payload === "object" ? (
                <pre className="text-xs bg-muted rounded-md p-4 overflow-auto max-h-96">
                  {JSON.stringify(a.payload, null, 2)}
                </pre>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </main>
    </PortalShell>
  );
}
