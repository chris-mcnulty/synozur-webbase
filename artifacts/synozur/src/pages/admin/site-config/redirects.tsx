import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
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

interface Redirect {
  id: string;
  sourcePath: string;
  targetPath: string;
  statusCode: number;
  active: boolean;
  notes: string | null;
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: Redirect[];
}

async function listRedirects(): Promise<ListResponse> {
  return apiFetch<ListResponse>("/api/cms/wix-redirects");
}

interface UpsertInput {
  sourcePath: string;
  targetPath: string;
  statusCode?: 301 | 302;
  active?: boolean;
  notes?: string | null;
}

async function createRedirect(body: UpsertInput): Promise<Redirect> {
  return apiFetch<Redirect>("/api/cms/wix-redirects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function updateRedirect(id: string, body: Partial<UpsertInput>): Promise<Redirect> {
  return apiFetch<Redirect>(`/api/cms/wix-redirects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function deleteRedirect(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/cms/wix-redirects/${id}`, { method: "DELETE" });
}

function emptyDraft(): UpsertInput {
  return { sourcePath: "", targetPath: "", statusCode: 301, active: true, notes: "" };
}

export default function AdminWixRedirects() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery<ListResponse, Error>({
    queryKey: ["/api/cms/wix-redirects"],
    queryFn: listRedirects,
  });

  const [draft, setDraft] = useState<UpsertInput>(emptyDraft());
  const [editTarget, setEditTarget] = useState<Redirect | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<UpsertInput>>({});

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/cms/wix-redirects"] });

  const createMut = useMutation({
    mutationFn: createRedirect,
    onSuccess: () => {
      toast({ title: "Redirect created" });
      setDraft(emptyDraft());
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UpsertInput> }) =>
      updateRedirect(id, body),
    onSuccess: () => {
      toast({ title: "Redirect updated" });
      setEditTarget(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRedirect,
    onSuccess: () => {
      toast({ title: "Redirect deleted" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const onEdit = (r: Redirect) => {
    setEditDraft({
      sourcePath: r.sourcePath,
      targetPath: r.targetPath,
      statusCode: r.statusCode as 301 | 302,
      active: r.active,
      notes: r.notes ?? "",
    });
    setEditTarget(r);
  };

  const onSaveEdit = () => {
    if (!editTarget) return;
    const sourcePath = editDraft.sourcePath?.trim() ?? "";
    const targetPath = editDraft.targetPath?.trim() ?? "";
    if (!sourcePath || !targetPath) {
      toast({ title: "Source and target are required", variant: "destructive" });
      return;
    }
    if (!sourcePath.startsWith("/") || !targetPath.startsWith("/")) {
      toast({ title: "Paths must start with /", variant: "destructive" });
      return;
    }
    updateMut.mutate({
      id: editTarget.id,
      body: {
        sourcePath,
        targetPath,
        statusCode: editDraft.statusCode ?? 301,
        active: editDraft.active ?? true,
        notes: editDraft.notes?.trim() || null,
      },
    });
  };

  const items = listQ.data?.items ?? [];

  const onAdd = () => {
    if (!draft.sourcePath.trim() || !draft.targetPath.trim()) {
      toast({ title: "Source and target are required", variant: "destructive" });
      return;
    }
    if (!draft.sourcePath.startsWith("/") || !draft.targetPath.startsWith("/")) {
      toast({ title: "Paths must start with /", variant: "destructive" });
      return;
    }
    createMut.mutate({
      sourcePath: draft.sourcePath.trim(),
      targetPath: draft.targetPath.trim(),
      statusCode: draft.statusCode,
      active: draft.active,
      notes: draft.notes?.trim() || null,
    });
  };

  return (
    <AdminLayout
      title="Wix URL redirects"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Wix redirects" }]}
    >
      <div className="space-y-6">
        {!canWrite && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            You have read-only access. Only editors and admins can change redirects.
          </div>
        )}

        {canWrite && (
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-3 items-end">
              <div>
                <Label htmlFor="sourcePath">Old Wix path</Label>
                <Input
                  id="sourcePath"
                  placeholder="/post"
                  value={draft.sourcePath}
                  onChange={(e) => setDraft((d) => ({ ...d, sourcePath: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="targetPath">New path</Label>
                <Input
                  id="targetPath"
                  placeholder="/insights"
                  value={draft.targetPath}
                  onChange={(e) => setDraft((d) => ({ ...d, targetPath: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="statusCode">Status</Label>
                <select
                  id="statusCode"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={draft.statusCode}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      statusCode: Number(e.target.value) === 302 ? 302 : 301,
                    }))
                  }
                >
                  <option value={301}>301</option>
                  <option value={302}>302</option>
                </select>
              </div>
              <Button onClick={onAdd} disabled={createMut.isPending}>
                <Plus className="h-4 w-4 mr-1" />
                {createMut.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="e.g. Inbound links from old campaign"
                value={draft.notes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="w-[80px]">Code</TableHead>
                <TableHead className="w-[80px]">Hits</TableHead>
                <TableHead className="w-[100px]">Active</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
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
                    Failed to load redirects: {listQ.error?.message}
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No redirects yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sourcePath}</TableCell>
                    <TableCell className="font-mono text-xs">{r.targetPath}</TableCell>
                    <TableCell>{r.statusCode}</TableCell>
                    <TableCell>{r.hitCount}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.active}
                        disabled={!canWrite || updateMut.isPending}
                        onCheckedChange={(v) =>
                          updateMut.mutate({ id: r.id, body: { active: v } })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (!confirm(`Delete redirect ${r.sourcePath} → ${r.targetPath}?`)) {
                                return;
                              }
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

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit redirect</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="edit-sourcePath">Old Wix path</Label>
              <Input
                id="edit-sourcePath"
                value={editDraft.sourcePath ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, sourcePath: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit-targetPath">New path</Label>
              <Input
                id="edit-targetPath"
                value={editDraft.targetPath ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, targetPath: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit-statusCode">Status</Label>
              <select
                id="edit-statusCode"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={editDraft.statusCode ?? 301}
                onChange={(e) =>
                  setEditDraft((d) => ({
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
              <Label htmlFor="edit-notes">Notes (optional)</Label>
              <Input
                id="edit-notes"
                value={editDraft.notes ?? ""}
                onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="edit-active"
                checked={editDraft.active ?? true}
                onCheckedChange={(v) => setEditDraft((d) => ({ ...d, active: v }))}
              />
              <Label htmlFor="edit-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={onSaveEdit} disabled={updateMut.isPending}>
              {updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
