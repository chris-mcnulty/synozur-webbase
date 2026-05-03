import { Link } from "wouter";
import {
  useListPortalApps,
  useGetPortalMe,
  type PortalAppCard,
  type PortalForbiddenReason,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import NotCustomer from "./not-customer";
import { PortalShell } from "@/components/portal-shell";

// /apps cockpit landing — six cards, one per Synozur application. Each card
// shows the artifact count this client has access to; clicking a card drops
// the customer onto the per-app surface (`/apps/:sourceApp`).

function AppCard({ card }: { card: PortalAppCard }) {
  const empty = card.artifactCount === 0;
  return (
    <Link href={`/apps/${card.sourceApp}`}>
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
      <a
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        data-testid={`app-card-${card.sourceApp}`}
      >
        <Card className="hover-elevate h-full">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-md bg-muted overflow-hidden flex items-center justify-center text-xs font-semibold uppercase">
                  {card.logo ? (
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onError is a recovery hook, not user interaction.
                    <img
                      src={card.logo}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  ) : (
                    card.sourceApp[0]
                  )}
                </div>
                <h3 className="text-base font-semibold leading-tight truncate">
                  {card.name}
                </h3>
              </div>
              <Badge variant={empty ? "outline" : "default"}>
                {empty ? "—" : card.artifactCount}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {card.tagline}
            </p>
            <p className="text-xs text-muted-foreground">
              {empty
                ? "Nothing published yet"
                : `${card.artifactCount} ${card.artifactCount === 1 ? "artifact" : "artifacts"}`}
            </p>
          </CardContent>
        </Card>
      </a>
    </Link>
  );
}

export default function AppsPage() {
  const meQuery = useGetPortalMe();
  const appsQuery = useListPortalApps();

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = (meQuery.error ?? appsQuery.error) as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();
  if (forbiddenReason) return <NotCustomer reason={forbiddenReason} />;

  const me = meQuery.data;
  const isLoading = meQuery.isLoading || appsQuery.isLoading;
  const cards = appsQuery.data?.items ?? [];

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {me?.organization.name ?? ""}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Your apps</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Each cockpit gathers the outputs your Synozur team has produced
            inside one of our apps. Open a card to see what's been published
            for you.
          </p>
        </section>

        <section
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="apps-grid"
        >
          {isLoading ? (
            <>
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
            </>
          ) : (
            cards.map((c) => <AppCard key={c.sourceApp} card={c} />)
          )}
        </section>
      </main>
    </PortalShell>
  );
}
