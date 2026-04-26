import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface NotFoundLog {
  id: string;
  path: string;
  normalizedPath: string;
  hitCount: number;
  lastReferrer: string | null;
  lastUserAgent: string | null;
  resolved: boolean;
  notes: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: NotFoundLog[];
}

type Filter = "false" | "true" | "all";

async function listLogs(filter: Filter): Promise<ListResponse> {
  return apiFetch<ListResponse>(`/api/cms/not-found-logs?resolved=${filter}`);
}

async function patchLog(
  id: string,
  body: { resolved?: boolean; notes?: string | null },
): Promise<NotFoundLog> {
  return apiFetch<NotFoundLog>(`/api/cms/not-found-logs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function deleteLog(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/cms/not-found-logs/${id}`, { method: "DELETE" });
}

interface CreateRedirectInput {
  targetPath: string;
  statusCode?: 301 | 302;
  notes?: string | null;
}

async function createRedirectFromLog(
  id: string,
  body: CreateRedirectInput,
): Promise<{ redirect: { id: string; sourcePath: string; targetPath: string } }> {
  return apiFetch(`/api/cms/not-found-logs/${id}/redirect`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminNotFoundLogs() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = !!access?.isEditorOrAbove;

  const [filter, setFilter] = useState<Filter>("false");
  const queryKey = useMemo(
    () => ["/api/cms/not-found-logs", filter] as const,
    [filter],
  );

  const listQ = useQuery<ListResponse, Error>({
    queryKey,
    queryFn: () => listLogs(filter),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/api/cms/not-found-logs"] });

  const patchMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { resolved?: boolean; notes?: string | null };
    }) => patchLog(id, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLog,
    onSuccess: () => {
      toast({ title: "Log entry deleted" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const [redirectTarget, setRedirectTarget] = useState<NotFoundLog | null>(null);
  const [redirectDraft, setRedirectDraft] = useState<CreateRedirectInput>({
    targetPath: "",
    statusCode: 301,
    notes: "",
  });

  const createRedirectMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateRedirectInput }) =>
      createRedirectFromLog(id, body),
    onSuccess: (resp) => {
      toast({
        title: "Redirect created",
        description: `${resp.redirect.sourcePath} → ${resp.redirect.targetPath}`,
      });
      setRedirectTarget(null);
      setRedirectDraft({ targetPath: "", statusCode: 301, notes: "" });
      invalidate();
      qc.invalidateQueries({ queryKey: ["/api/cms/wix-redirects"] });
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const onOpenRedirect = (row: NotFoundLog) => {
    setRedirectTarget(row);
    setRedirectDraft({ targetPath: "", statusCode: 301, notes: "" });
  };

  const onSubmitRedirect = () => {
    if (!redirectTarget) return;
    const target = redirectDraft.targetPath.trim();
    if (!target.startsWith("/")) {
      toast({ title: "Target must start with /", variant: "destructive" });
      return;
    }
    createRedirectMut.mutate({
      id: redirectTarget.id,
      body: {
        targetPath: target,
        statusCode: redirectDraft.statusCode ?? 301,
        notes: redirectDraft.notes?.trim() || null,
      },
    });
  };

  const items = listQ.data?.items ?? [];

  return (
    <AdminLayout
      title="404 log"
      crumbs={[{ label: "Admin", href: "/" }, { label: "404 log" }]}
    >
      <div className="space-y-6">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Every distinct path that hit the 404 page is logged here. Sorted by
            hit count so you can see which broken URLs to prioritize for a
            redirect. Creating a redirect from a row marks it resolved
            automatically.
          </p>
        </Card>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Show</Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              data-testid="filter-not-found-status"
            >
              <option value="false">Unresolved</option>
              <option value="true">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => listQ.refetch()}
            disabled={listQ.isFetching}
          >
            <RefreshCcw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>

        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead className="w-[80px]">Hits</TableHead>
                <TableHead className="w-[180px]">Last seen</TableHead>
                <TableHead>Last referrer</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : listQ.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-destructive">
                    Failed to load: {listQ.error?.message}
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No 404s logged for the selected filter.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs break-all">
                      {r.path}
                    </TableCell>
                    <TableCell>{r.hitCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(r.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground break-all">
                      {r.lastReferrer ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.resolved ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Resolved
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Open</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {canWrite && !r.resolved && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenRedirect(r)}
                          data-testid={`btn-create-redirect-${r.id}`}
                        >
                          <ArrowRight className="h-4 w-4 mr-1" />
                          Redirect
                        </Button>
                      )}
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={r.resolved ? "Mark unresolved" : "Mark resolved"}
                            onClick={() =>
                              patchMut.mutate({
                                id: r.id,
                                body: { resolved: !r.resolved },
                              })
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (!confirm(`Delete log entry for ${r.path}?`)) return;
                              deleteMut.mutate(r.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog
        open={!!redirectTarget}
        onOpenChange={(open) => {
          if (!open) setRedirectTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create redirect from 404</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Source path (from log)</Label>
              <Input
                value={redirectTarget?.path ?? ""}
                disabled
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="nf-target">New target path</Label>
              <Input
                id="nf-target"
                placeholder="/insights"
                value={redirectDraft.targetPath}
                onChange={(e) =>
                  setRedirectDraft((d) => ({ ...d, targetPath: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="nf-status">Status</Label>
              <select
                id="nf-status"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={redirectDraft.statusCode ?? 301}
                onChange={(e) =>
                  setRedirectDraft((d) => ({
                    ...d,
                    statusCode: Number(e.target.value) === 302 ? 302 : 301,
                  }))
                }
              >
                <option value={301}>301 Permanent</option>
                <option value={302}>302 Temporary</option>
              </select>
            </div>
            <div>
              <Label htmlFor="nf-notes">Notes (optional)</Label>
              <Input
                id="nf-notes"
                placeholder="e.g. Old Wix slug from the launch announcement"
                value={redirectDraft.notes ?? ""}
                onChange={(e) =>
                  setRedirectDraft((d) => ({ ...d, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedirectTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={onSubmitRedirect}
              disabled={createRedirectMut.isPending}
            >
              {createRedirectMut.isPending ? "Creating…" : "Create redirect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
