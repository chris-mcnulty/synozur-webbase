import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useDeleteBoardProfile,
  useListAdminBoard,
  useSetBoardVisibility,
  type BoardProfile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  BOARD_KEY_ROOT,
  BOARD_REQUEST,
  BOARD_STATUS_POLL_MS,
  useBoardIdentity,
} from "@/lib/board";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** Strict role gate: admin / site_admin only, after auth has loaded. */
export function BoardAdminGate({ children }: { children: ReactNode }) {
  const id = useBoardIdentity();
  if (!id.isLoaded) {
    return (
      <AdminLayout title="Board of Advisors">
        <div className="space-y-3 animate-pulse" data-testid="board-admin-loading">
          <div className="h-8 w-1/3 bg-muted rounded" />
          <div className="h-40 bg-muted rounded" />
        </div>
      </AdminLayout>
    );
  }
  if (!id.isAdmin) {
    return (
      <AdminLayout title="Board of Advisors">
        <div className="rounded-lg border border-border p-8 max-w-xl" data-testid="board-admin-forbidden">
          <Lock className="h-5 w-5 text-primary mb-3" />
          <h2 className="text-lg font-semibold mb-2">Admins only</h2>
          <p className="text-sm text-muted-foreground">
            The Board of Advisors is managed by site admins. Ask an admin if you need a change.
          </p>
        </div>
      </AdminLayout>
    );
  }
  return <>{children}</>;
}

function BoardListInner() {
  const qc = useQueryClient();
  const id = useBoardIdentity();
  const [pendingDelete, setPendingDelete] = useState<BoardProfile | null>(null);
  const [confirmVis, setConfirmVis] = useState<null | boolean>(null);
  const [error, setError] = useState<string | null>(null);

  const listQ = useListAdminBoard({
    query: {
      queryKey: id.key("admin", "list"),
      enabled: id.isAdmin,
      staleTime: 0,
      gcTime: 0,
      refetchInterval: BOARD_STATUS_POLL_MS,
    },
    request: BOARD_REQUEST,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: [BOARD_KEY_ROOT] });

  const del = useDeleteBoardProfile({
    request: BOARD_REQUEST,
    mutation: {
      onSuccess: () => { setPendingDelete(null); invalidate(); },
      onError: (e) => setError((e as Error).message ?? "Delete failed"),
    },
  });
  const vis = useSetBoardVisibility({
    request: BOARD_REQUEST,
    mutation: {
      onSuccess: () => { setConfirmVis(null); invalidate(); },
      onError: (e) => setError((e as Error).message ?? "Could not change visibility"),
    },
  });

  const roster = listQ.data;
  const items = listQ.isError ? [] : roster?.items ?? [];
  const isPublic = !listQ.isError && roster?.public === true;

  return (
    <AdminLayout
      title="Board of Advisors"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Board of Advisors" }]}
      actions={
        <div className="flex items-center gap-2">
          <a href={`${BASE_PATH}/board`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" data-testid="button-preview-board">
              <ExternalLink className="h-4 w-4 mr-2" /> Preview
            </Button>
          </a>
          <Link href="/people/board/new">
            <Button data-testid="button-new-board-profile">
              <Plus className="h-4 w-4 mr-2" /> New Advisor
            </Button>
          </Link>
        </div>
      }
    >
      <div
        className={`rounded-lg border p-5 mb-6 flex flex-col md:flex-row md:items-center gap-4 justify-between ${isPublic ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40"}`}
        data-testid="panel-board-visibility"
      >
        <div className="flex items-start gap-3">
          {isPublic ? <Globe className="h-5 w-5 text-primary mt-0.5" /> : <Lock className="h-5 w-5 text-muted-foreground mt-0.5" />}
          <div>
            <p className="font-semibold" data-testid="status-board-visibility">
              {listQ.isLoading ? "Checking visibility…" : isPublic ? "Published — visible to everyone" : "Private — admins only"}
            </p>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {isPublic
                ? "Anyone can open /board, the link appears in the site header and footer, and pages can be indexed by search engines."
                : "Only admins can open /board. It is hidden from navigation and marked noindex. Visitors get a not-found page."}
            </p>
          </div>
        </div>
        {!listQ.isLoading && !listQ.isError && (
          isPublic ? (
            <Button variant="outline" onClick={() => setConfirmVis(false)} data-testid="button-restrict-board">
              <Lock className="h-4 w-4 mr-2" /> Restrict to admins
            </Button>
          ) : (
            <Button onClick={() => setConfirmVis(true)} data-testid="button-publish-board">
              <Globe className="h-4 w-4 mr-2" /> Publish board
            </Button>
          )
        )}
      </div>

      {error && <div className="text-destructive text-sm mb-4" data-testid="text-board-error">{error}</div>}

      {listQ.isLoading ? (
        <div className="space-y-2 animate-pulse" data-testid="board-admin-list-loading">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}
        </div>
      ) : listQ.isError ? (
        <div className="rounded-lg border border-border p-6 text-sm">
          <p className="text-muted-foreground mb-3">Could not load the board.</p>
          <Button variant="outline" size="sm" onClick={() => listQ.refetch()} data-testid="button-board-list-retry">Retry</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center" data-testid="board-admin-empty">
          <p className="font-semibold mb-1">No advisors yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Add an external advisor with their own bio, or link an existing Team member.
          </p>
          <Link href="/people/board/new">
            <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Add the first advisor</Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} data-testid={`row-board-${p.id}`}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">/board/{p.slug}</div>
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs rounded-full px-2 py-0.5 border ${p.group === "external" ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`}>
                      {p.group === "external" ? "External" : "Synozur team"}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{p.sortOrder ?? 0}</TableCell>
                  <TableCell>{p.active ? "Active" : <span className="text-muted-foreground">Hidden</span>}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <a href={`${BASE_PATH}/board/${encodeURIComponent(p.slug)}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" aria-label="Preview" data-testid={`button-preview-board-${p.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </a>
                      <Link href={`/people/board/${p.id}`}>
                        <Button variant="ghost" size="icon" aria-label="Edit" data-testid={`button-edit-board-${p.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setPendingDelete(p)} data-testid={`button-delete-board-${p.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name} from the board?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.group === "internal"
                ? "Only the board listing is removed. The linked Team profile is not touched."
                : "This deletes the advisor's board profile and bio permanently."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (pendingDelete) del.mutate({ id: pendingDelete.id }); }}
              disabled={del.isPending}
              data-testid="button-confirm-delete-board"
            >
              {del.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmVis !== null} onOpenChange={(o) => !o && setConfirmVis(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmVis ? "Publish the Board of Advisors?" : "Restrict the board to admins?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmVis
                ? "Every active advisor becomes visible to anyone at /board. A Board link appears in the header and footer, and search engines may index these pages."
                : "Visitors will immediately lose access to /board and every advisor page. The nav links disappear and pages are marked noindex. Copies already indexed by search engines may take time to drop."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (confirmVis !== null) vis.mutate({ data: { public: confirmVis } }); }}
              disabled={vis.isPending}
              data-testid="button-confirm-visibility"
            >
              {vis.isPending ? "Saving…" : confirmVis ? "Publish" : "Restrict"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

export default function AdminBoardList() {
  return (
    <BoardAdminGate>
      <BoardListInner />
    </BoardAdminGate>
  );
}
