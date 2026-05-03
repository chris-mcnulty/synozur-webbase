import {
  useGetPortalMe,
  useListPortalEngagements,
  type PortalAccountTeamMember,
  type PortalEngagement,
  type PortalForbiddenReason,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/auth";
import NotCustomer from "./not-customer";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Hello";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const ROLE_LABEL: Record<PortalAccountTeamMember["role"], string> = {
  account_manager: "Account manager",
  primary_contact: "Primary contact",
};

const STATUS_LABEL: Record<PortalEngagement["status"], string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

function PersonRow({ person }: { person: PortalAccountTeamMember }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-10 w-10">
        {person.avatarUrl ? (
          <AvatarImage src={person.avatarUrl} alt={person.displayName ?? ""} />
        ) : null}
        <AvatarFallback>
          {initials(person.displayName, person.email?.[0]?.toUpperCase() ?? "?")}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {person.displayName ?? person.email ?? "Team member"}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {ROLE_LABEL[person.role]}
          {person.email ? ` · ${person.email}` : ""}
        </p>
      </div>
    </div>
  );
}

function EngagementCard({ engagement }: { engagement: PortalEngagement }) {
  const lead = engagement.accountLead;
  return (
    <Card className="hover-elevate" data-testid={`engagement-${engagement.slug}`}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h3 className="text-base font-semibold leading-tight">
              {engagement.title}
            </h3>
            {engagement.startedAt ? (
              <p className="text-xs text-muted-foreground">
                Started {new Date(engagement.startedAt).toLocaleDateString()}
              </p>
            ) : null}
          </div>
          <Badge
            variant={engagement.status === "active" ? "default" : "secondary"}
          >
            {STATUS_LABEL[engagement.status]}
          </Badge>
        </div>
        {engagement.summary ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {engagement.summary}
          </p>
        ) : null}
        {lead ? (
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Avatar className="h-7 w-7">
              {lead.avatarUrl ? (
                <AvatarImage src={lead.avatarUrl} alt={lead.displayName ?? ""} />
              ) : null}
              <AvatarFallback className="text-[10px]">
                {initials(lead.displayName, "?")}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">
              Led by{" "}
              <span className="text-foreground font-medium">
                {lead.displayName ?? lead.email ?? "your team"}
              </span>
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { user, signOut } = useAuth();
  const meQuery = useGetPortalMe();
  const engagementsQuery = useListPortalEngagements();

  // 403 with a structured reason is rendered as the not-customer page.
  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = (meQuery.error ?? engagementsQuery.error) as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();

  if (forbiddenReason) {
    return <NotCustomer reason={forbiddenReason} />;
  }

  const me = meQuery.data;
  const engagements = engagementsQuery.data?.items ?? [];
  const isLoading = meQuery.isLoading || engagementsQuery.isLoading;

  return (
    <div className="min-h-screen w-full bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
              G
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Galaxy</p>
              <p className="text-xs text-muted-foreground leading-tight">
                Synozur customer portal
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user?.email ? (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {user.email}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              data-testid="button-sign-out"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {me?.organization.name ?? (isLoading ? "" : "Welcome")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting()},{" "}
            <span data-testid="text-greeting-name">
              {user?.displayName?.split(" ")[0] ?? user?.email ?? "there"}
            </span>
            .
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Here's where your Synozur work lives. Engagements, account team,
            and the documents your team is putting together for you all show
            up here.
          </p>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Active engagements</h2>
              <span className="text-xs text-muted-foreground">
                {isLoading ? "" : `${engagements.length} total`}
              </span>
            </div>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : engagements.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No engagements yet. When your Synozur team kicks one off,
                  you'll see it here.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {engagements.map((e) => (
                  <EngagementCard key={e.id} engagement={e} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Your account team</h2>
            <Card>
              <CardContent className="p-5 space-y-4">
                {isLoading ? (
                  <>
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </>
                ) : !me || me.accountTeam.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Your account team will be assigned soon.
                  </p>
                ) : (
                  me.accountTeam.map((p) => <PersonRow key={p.id} person={p} />)
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
