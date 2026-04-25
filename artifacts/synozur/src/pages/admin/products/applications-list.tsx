import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Pencil, Trash2, Star, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { api, type ApplicationDto } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export default function AdminApplicationsList() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({
    queryKey: ["admin-applications"],
    queryFn: () => api.adminListApplications(),
  });
  const items: ApplicationDto[] = listQ.data?.items ?? [];

  const updateMut = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Parameters<typeof api.updateApplication>[1];
    }) => api.updateApplication(id, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-applications"] }),
    onError: (e: Error) =>
      toast({
        title: "Update failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteApplication(id),
    onSuccess: () => {
      toast({ title: "Application archived" });
      qc.invalidateQueries({ queryKey: ["admin-applications"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const onToggleActive = (a: ApplicationDto, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: a.id, data: { title: a.title, active } });
  };
  const onToggleFeatured = (a: ApplicationDto, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: a.id, data: { title: a.title, featured } });
  };
  const onToggleNav = (a: ApplicationDto, showInNav: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: a.id, data: { title: a.title, showInNav } });
  };
  const onDelete = (a: ApplicationDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${a.title}"?`)) return;
    deleteMut.mutate(a.id);
  };

  return (
    <AdminLayout
      title="Applications"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Applications" }]}
      actions={
        canWrite ? (
          <Button onClick={() => navigate("/applications/new")} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New application
          </Button>
        ) : undefined
      }
    >
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Application</TableHead>
              <TableHead className="w-20">Version</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24 text-center">Featured</TableHead>
              <TableHead className="w-20 text-center">In Nav</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  No applications yet. Run{" "}
                  <code>
                    pnpm --filter @workspace/api-server run seed:applications
                  </code>{" "}
                  to import from the static TS file, or pass{" "}
                  <code>--csv</code> to import from the Wix CSV export.
                </TableCell>
              </TableRow>
            ) : (
              items.map((a) => (
                <TableRow key={a.id} data-testid={`row-application-${a.id}`}>
                  <TableCell className="font-medium">
                    <div>{a.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      /applications/{a.slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {a.version ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABELS[a.status] ?? a.status}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleFeatured(a, !a.featured)}
                      disabled={!canWrite}
                      className="inline-flex items-center justify-center"
                      aria-label={
                        a.featured ? "Remove from featured" : "Mark as featured"
                      }
                    >
                      <Star
                        className={
                          "h-4 w-4 " +
                          (a.featured
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground")
                        }
                      />
                    </button>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={a.showInNav}
                      onCheckedChange={(next) => onToggleNav(a, next)}
                      disabled={!canWrite}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={a.active}
                      onCheckedChange={(next) => onToggleActive(a, next)}
                      disabled={!canWrite}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {a.websiteUrl && (
                        <a
                          href={a.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Open website"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      <a
                        href={`/applications/${a.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View on public site"
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit application"
                        onClick={() => navigate(`/applications/${a.id}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(a)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
