import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, RefreshCw, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
    case "delivered":
      return "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200";
    case "processing":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
    case "purged":
    case "revoked":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
  }
}

export default function AdminBriefingPodcast() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgLabel, setOrgLabel] = useState("");

  const clientsQuery = useQuery({
    queryKey: ["briefing-podcast-clients"],
    queryFn: () => api.listBriefingPodcastClients(),
  });
  const historyQuery = useQuery({
    queryKey: ["briefing-podcasts"],
    queryFn: () => api.listBriefingPodcasts(50),
  });

  const addClient = useMutation({
    mutationFn: () =>
      api.upsertBriefingPodcastClient({
        email: email.trim(),
        displayName: displayName.trim() || null,
        organizationLabel: orgLabel.trim() || null,
        status: "approved",
      }),
    onSuccess: () => {
      toast({ title: "Sender approved" });
      setEmail("");
      setDisplayName("");
      setOrgLabel("");
      void queryClient.invalidateQueries({
        queryKey: ["briefing-podcast-clients"],
      });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not approve sender",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const removeClient = useMutation({
    mutationFn: (id: string) => api.deleteBriefingPodcastClient(id),
    onSuccess: () => {
      toast({ title: "Sender removed" });
      void queryClient.invalidateQueries({
        queryKey: ["briefing-podcast-clients"],
      });
    },
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.purgeBriefingPodcast(id),
    onSuccess: () => {
      toast({ title: "Recording purged" });
      void queryClient.invalidateQueries({ queryKey: ["briefing-podcasts"] });
    },
  });

  const clients = clientsQuery.data?.clients ?? [];
  const podcasts = historyQuery.data?.podcasts ?? [];

  return (
    <AdminLayout
      title="Briefing Podcast"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Briefing Podcast" }]}
    >
      <div className="space-y-10">
        <p className="text-sm text-muted-foreground">
          Approve external senders who can email a briefing and receive an
          audio version back, and review generated recordings.
        </p>
        {/* Approved senders */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Headphones className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Approved senders</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Only these addresses may submit a briefing to the watched mailbox
            and get a podcast in return. Other senders are ignored.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Email</span>
              <Input
                type="email"
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-64"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Name (optional)</span>
              <Input
                placeholder="Jane Client"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Org / note (optional)</span>
              <Input
                placeholder="Acme Corp"
                value={orgLabel}
                onChange={(e) => setOrgLabel(e.target.value)}
                className="w-48"
              />
            </div>
            <Button
              onClick={() => addClient.mutate()}
              disabled={!email.trim() || addClient.isPending}
            >
              {addClient.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Approve
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Org / note</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No approved senders yet.
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-sm">{c.email}</TableCell>
                    <TableCell>{c.displayName ?? "—"}</TableCell>
                    <TableCell>{c.organizationLabel ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(c.status)}`}
                      >
                        {c.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(c.approvedAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeClient.mutate(c.id)}
                        disabled={removeClient.isPending}
                        aria-label="Remove sender"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>

        {/* Generated recordings */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent recordings</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void historyQuery.refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {podcasts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No recordings yet.
                  </TableCell>
                </TableRow>
              ) : (
                podcasts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">
                      {p.recipientEmail}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{p.subject}</TableCell>
                    <TableCell>{p.source}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${statusBadgeClass(p.status)}`}
                      >
                        {p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(p.createdAt)}
                    </TableCell>
                    <TableCell>
                      {p.status === "delivered" && p.speItemId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => purge.mutate(p.id)}
                          disabled={purge.isPending}
                          aria-label="Purge recording"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </div>
    </AdminLayout>
  );
}
