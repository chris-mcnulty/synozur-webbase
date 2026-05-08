import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Trash2,
  Plus,
  CalendarClock,
  ExternalLink,
  Plug,
  PlugZap,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { api, type BookingDto } from "@/lib/api";

const SCOPE_LABEL: Record<string, string> = {
  general: "General",
  offer: "Offer",
  conference: "Conference",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function windowText(b: BookingDto): string {
  const start = formatDate(b.startsAt);
  const end = formatDate(b.endsAt);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Opens ${start}`;
  if (end) return `Through ${end}`;
  return "Always available";
}

// ---------------------------------------------------------------------------
// Microsoft Graph connection card
// ---------------------------------------------------------------------------

function GraphConnectionCard() {
  const qc = useQueryClient();
  const [location] = useLocation();

  // Surface success / error messages from the OAuth callback redirect.
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const justConnected = params.get("graphConnected") === "1";
  const connectError = params.get("graphError");

  // Clean the query string from the URL once we've read it so a refresh
  // doesn't re-show the banner.
  useEffect(() => {
    if (justConnected || connectError) {
      const clean = window.location.pathname;
      window.history.replaceState(null, "", clean);
    }
  }, [justConnected, connectError, location]);

  const { data, isLoading } = useQuery({
    queryKey: ["bookings-graph-status"],
    queryFn: () => api.bookingsGraphStatus(),
    staleTime: 30_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.bookingsGraphDisconnect(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings-graph-status"] });
    },
  });

  const connected = data?.connected ?? false;
  const account = data?.account ?? null;
  const entraConfigured = data?.entraConfigured ?? true;

  return (
    <div className="rounded-xl border border-border mb-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 border-b border-border">
        <PlugZap className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium">Microsoft Graph connection</span>
        {!isLoading && (
          <span
            className={`ml-auto flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
              connected
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {connected ? (
              <CircleCheck className="h-3 w-3" />
            ) : (
              <CircleAlert className="h-3 w-3" />
            )}
            {connected ? "Connected" : "Not connected"}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Success / error banners from OAuth redirect */}
        {justConnected && (
          <div className="text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">
            Service account connected successfully.
          </div>
        )}
        {connectError && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {decodeURIComponent(connectError)}
          </div>
        )}

        {isLoading ? (
          <div className="h-4 w-48 rounded bg-muted animate-pulse" />
        ) : !entraConfigured ? (
          <p className="text-sm text-muted-foreground">
            Microsoft Entra is not configured on this server (
            <code className="text-xs">ENTRA_TENANT_ID</code> /{" "}
            <code className="text-xs">ENTRA_APP_CLIENT_ID</code> missing).
          </p>
        ) : connected ? (
          <p className="text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {account ?? "unknown account"}
            </span>
            . The native booking flow can call Microsoft Graph on behalf of this account.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The native booking flow needs a delegated service-account token to call
            Microsoft Bookings. Click <strong>Connect service account</strong> to sign in
            once; the token is stored and refreshed automatically.
          </p>
        )}

        {/* Prerequisite note */}
        {!isLoading && entraConfigured && (
          <p className="text-xs text-muted-foreground">
            Prerequisite: add{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              /api/admin/bookings/graph-callback
            </code>{" "}
            to the Entra app registration's Redirect URIs (Web platform) before connecting.
          </p>
        )}

        {/* Actions */}
        {!isLoading && entraConfigured && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant={connected ? "outline" : "default"}
              onClick={() => {
                window.location.href = api.bookingsGraphAuthorizeHref();
              }}
            >
              <Plug className="h-3.5 w-3.5 mr-1.5" />
              {connected ? "Reconnect" : "Connect service account"}
            </Button>
            {connected && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={disconnectMutation.isPending}
                onClick={() => {
                  if (confirm("Disconnect the service account? The native booking flow will stop working until reconnected.")) {
                    disconnectMutation.mutate();
                  }
                }}
              >
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminBookingsList() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-bookings"],
    queryFn: () => api.adminListBookings(),
  });

  const bookings = data?.items ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteBooking(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-bookings"] });
      qc.invalidateQueries({ queryKey: ["public-bookings"] });
    },
  });

  return (
    <AdminLayout
      title="Bookings"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Bookings" },
      ]}
      actions={
        <Button asChild size="sm" data-testid="button-new-booking">
          <Link href="/people/bookings/new">
            <Plus className="h-4 w-4 mr-1.5" /> New Booking
          </Link>
        </Button>
      }
    >
      <GraphConnectionCard />

      <p className="text-sm text-muted-foreground mb-6">
        Microsoft Bookings calendars surfaced on <code className="text-xs">/start</code>.
        Time-bound entries (offers, conferences) are auto-hidden from the public
        listing once their window closes.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <CalendarClock className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No bookings yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          {bookings.map((b, idx) => (
            <div
              key={b.id}
              data-testid={`row-booking-${b.id}`}
              className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors ${
                idx !== bookings.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{b.title}</p>
                  <span className="text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {SCOPE_LABEL[b.scope] ?? b.scope}
                  </span>
                  {!b.active && (
                    <span className="text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-destructive/15 text-destructive">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  /start/{b.slug} · {windowText(b)}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={b.embedUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground hover:text-foreground p-2"
                  title="Open Bookings page in new tab"
                  data-testid={`link-embed-${b.id}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  data-testid={`button-edit-${b.id}`}
                >
                  <Link href={`/people/bookings/${b.id}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete booking "${b.title}"? This cannot be undone.`)) {
                      deleteMutation.mutate(b.id);
                    }
                  }}
                  data-testid={`button-delete-${b.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
