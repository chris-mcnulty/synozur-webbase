import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Plus, CalendarClock, ExternalLink } from "lucide-react";
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
