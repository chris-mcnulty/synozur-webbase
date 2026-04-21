import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser, useClerk } from "@clerk/react";
import { Pencil, Trash2, Plus, LogOut, Inbox, Settings, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useState } from "react";

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminEventsList() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const qc = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["admin-events"],
    queryFn: () => api.adminEvents(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-events"] }),
  });

  const [seedResult, setSeedResult] = useState<string | null>(null);
  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${baseUrl}/api/admin/seed-events`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ inserted: number; skipped: number }>;
    },
    onSuccess: (data) => {
      setSeedResult(`Done — ${data.inserted} inserted, ${data.skipped} skipped.`);
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (err: any) => setSeedResult(`Error: ${err.message}`),
  });

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Events Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Signed in as {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/submissions">
            <Button variant="outline" data-testid="button-view-submissions">
              <Inbox className="h-4 w-4 mr-2" /> Submissions
            </Button>
          </Link>
          <Link href="/site-settings">
            <Button variant="outline" data-testid="button-site-settings">
              <Settings className="h-4 w-4 mr-2" /> Site settings
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Seed events from the CSV export? Existing slugs will be skipped.")) {
                seedMutation.mutate();
              }
            }}
            disabled={seedMutation.isPending}
            data-testid="button-seed-events"
          >
            <Upload className="h-4 w-4 mr-2" />
            {seedMutation.isPending ? "Seeding…" : "Seed from CSV"}
          </Button>
          <Link href="/events/new">
            <Button data-testid="button-new-event">
              <Plus className="h-4 w-4 mr-2" /> New Event
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => signOut({ redirectUrl: `${baseUrl || ""}/` })}
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </div>

      {seedResult && (
        <div className="mb-4 px-4 py-2 rounded bg-muted text-sm text-muted-foreground flex items-center justify-between">
          <span>{seedResult}</span>
          <button onClick={() => setSeedResult(null)} className="ml-4 text-xs underline">Dismiss</button>
        </div>
      )}
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No events yet.
                  </TableCell>
                </TableRow>
              )}
              {events.map((e) => (
                <TableRow key={e.id} data-testid={`row-event-${e.id}`}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell>{formatDate(e.startDate)}</TableCell>
                  <TableCell>
                    <span className="text-xs uppercase tracking-wide px-2 py-1 rounded bg-muted">
                      {e.status}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {e.location ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Link href={`/events/${e.id}`}>
                        <Button variant="ghost" size="icon" data-testid={`button-edit-${e.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete event "${e.title}"?`)) {
                            deleteMutation.mutate(e.id);
                          }
                        }}
                        data-testid={`button-delete-${e.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
