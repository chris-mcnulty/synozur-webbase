import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Star, ExternalLink, Pencil, Plus } from "lucide-react";
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
import { api, type ModelDto } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export default function AdminModelsList() {
  const qc = useQueryClient();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({
    queryKey: ["admin-models"],
    queryFn: () => api.adminListModels(),
  });
  const items: ModelDto[] = listQ.data?.items ?? [];

  const updateMut = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Parameters<typeof api.updateModel>[1];
    }) => api.updateModel(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-models"] }),
    onError: (e: Error) =>
      toast({
        title: "Update failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteModel(id),
    onSuccess: () => {
      toast({ title: "Model archived" });
      qc.invalidateQueries({ queryKey: ["admin-models"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const onToggleActive = (m: ModelDto, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: m.id, data: { title: m.title, active } });
  };
  const onToggleFeatured = (m: ModelDto, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: m.id, data: { title: m.title, featured } });
  };
  const onDelete = (m: ModelDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${m.title}"? This will remove it from the public site.`)) return;
    deleteMut.mutate(m.id);
  };

  return (
    <AdminLayout
      title="Models"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Models" }]}
      actions={
        canWrite ? (
          <Link href="/products/models/new">
            <Button data-testid="button-new-model">
              <Plus className="h-4 w-4 mr-1" /> New model
            </Button>
          </Link>
        ) : undefined
      }
    >
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-32">Pillar</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24 text-center">Featured</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  No models yet. Seed via{" "}
                  <code>pnpm --filter @workspace/api-server run seed:models</code>{" "}
                  or create one via the API.
                </TableCell>
              </TableRow>
            ) : (
              items.map((m) => (
                <TableRow key={m.id} data-testid={`row-model-${m.id}`}>
                  <TableCell className="font-medium">
                    <div>{m.title}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      /models/{m.slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{m.pillar || "—"}</TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABELS[m.status] ?? m.status}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleFeatured(m, !m.featured)}
                      disabled={!canWrite}
                      className="inline-flex items-center justify-center"
                      aria-label={
                        m.featured ? "Remove from featured" : "Mark as featured"
                      }
                    >
                      <Star
                        className={
                          "h-4 w-4 " +
                          (m.featured
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground")
                        }
                      />
                    </button>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={m.active}
                      onCheckedChange={(next) => onToggleActive(m, next)}
                      disabled={!canWrite}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {canWrite && (
                        <Link href={`/products/models/${m.id}/edit`}>
                          <Button variant="ghost" size="icon" title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                      <Link href={`/models/${m.slug}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View on public site"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(m)}
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
