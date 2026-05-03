import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Plus, Upload, Calendar, Star } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    UPCOMING: "bg-emerald-500/15 text-emerald-400",
    ENDED: "bg-muted text-muted-foreground",
    CANCELLED: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={`text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

export default function AdminEventsList() {
  const qc = useQueryClient();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["admin-events"],
    queryFn: () => api.adminEvents(),
    select: (data) =>
      [...data].sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-events"] }),
  });

  const [seedResult, setSeedResult] = useState<string | null>(null);
  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE_PATH}/api/admin/seed-events`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ inserted: number; skipped: number }>;
    },
    onSuccess: (data) => {
      setSeedResult(`Done — ${data.inserted} inserted, ${data.skipped} skipped.`);
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (err: unknown) =>
      setSeedResult(`Error: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {events.length} event{events.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  "Seed events from the CSV export? Existing slugs will be updated.",
                )
              ) {
                seedMutation.mutate();
              }
            }}
            disabled={seedMutation.isPending}
            data-testid="button-seed-events"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            {seedMutation.isPending ? "Seeding…" : "Seed from CSV"}
          </Button>
          <Link href="/people/events/new">
            <Button size="sm" data-testid="button-new-event">
              <Plus className="h-4 w-4 mr-1.5" /> New Event
            </Button>
          </Link>
        </div>
      </div>

      {seedResult && (
        <div className="mb-4 px-4 py-2 rounded-md bg-muted text-sm text-muted-foreground flex items-center justify-between">
          <span>{seedResult}</span>
          <button
            onClick={() => setSeedResult(null)}
            className="ml-4 text-xs underline hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Calendar className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No events yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          {events.map((e, idx) => (
            <div
              key={e.id}
              data-testid={`row-event-${e.id}`}
              className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors ${idx !== events.length - 1 ? "border-b border-border" : ""}`}
            >
              {/* Thumbnail */}
              <div className="w-16 h-12 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                {e.imageUrl ? (
                  <img
                    src={e.imageUrl}
                    alt={e.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Calendar className="h-5 w-5 text-muted-foreground/40" />
                )}
              </div>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{e.title}</p>
                  {e.featured && (
                    <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-label="Featured" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(e.startDate)}
                  {e.location ? ` · ${e.location}` : ""}
                </p>
              </div>

              {/* Status */}
              <div className="hidden sm:block shrink-0">{statusBadge(e.status)}</div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Link href={`/people/events/${e.id}`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    data-testid={`button-edit-${e.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete event "${e.title}"? This will remove it from the public site.`)) {
                      deleteMutation.mutate(e.id);
                    }
                  }}
                  data-testid={`button-delete-${e.id}`}
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
