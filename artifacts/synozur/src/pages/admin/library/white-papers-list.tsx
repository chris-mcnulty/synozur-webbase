import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ExternalLink, Star, Download } from "lucide-react";
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
import { api, type WhitePaperDto } from "@/lib/api";

const DOC_TYPE_LABELS: Record<string, string> = {
  whitepaper: "White Paper",
  ebook: "eBook",
  report: "Report",
  guide: "Guide",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export default function AdminWhitePapersList() {
  const qc = useQueryClient();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({
    queryKey: ["admin-white-papers"],
    queryFn: () => api.adminListWhitePapers(),
  });
  const items: WhitePaperDto[] = listQ.data?.items ?? [];

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateWhitePaper>[1] }) =>
      api.updateWhitePaper(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-white-papers"] }),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteWhitePaper(id),
    onSuccess: () => {
      toast({ title: "White paper archived" });
      qc.invalidateQueries({ queryKey: ["admin-white-papers"] });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const onToggleActive = (w: WhitePaperDto, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: w.id, data: { title: w.title, active } });
  };

  const onToggleFeatured = (w: WhitePaperDto, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: w.id, data: { title: w.title, featured } });
  };

  const onDelete = (w: WhitePaperDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${w.title}"?`)) return;
    deleteMut.mutate(w.id);
  };

  return (
    <AdminLayout
      title="White Papers"
      crumbs={[{ label: "Admin", href: "/" }, { label: "White Papers" }]}
      actions={
        canWrite && (
          <Link href="/library/white-papers/new">
            <Button data-testid="button-create-white-paper">
              <Plus className="h-4 w-4 mr-2" /> New white paper
            </Button>
          </Link>
        )
      }
    >
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-32">Type</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24 text-center">Featured</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No white papers yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((w) => (
                <TableRow key={w.id} data-testid={`row-white-paper-${w.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/library/white-papers/${w.id}/edit`}>
                      <a className="hover:underline" data-testid={`link-edit-white-paper-${w.id}`}>
                        {w.title}
                      </a>
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">
                      /white-papers/{w.slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {DOC_TYPE_LABELS[w.docType] ?? w.docType}
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABELS[w.status] ?? w.status}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleFeatured(w, !w.featured)}
                      disabled={!canWrite}
                      className="inline-flex items-center justify-center"
                      aria-label={w.featured ? "Remove from featured" : "Mark as featured"}
                      data-testid={`button-toggle-featured-${w.id}`}
                    >
                      <Star
                        className={
                          "h-4 w-4 " +
                          (w.featured
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground")
                        }
                      />
                    </button>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={w.active}
                      onCheckedChange={(next) => onToggleActive(w, next)}
                      disabled={!canWrite}
                      data-testid={`switch-active-${w.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {w.documentUrl && (
                        <a href={w.documentUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" title="Open document">
                            <Download className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      {w.externalUrl && (
                        <a href={w.externalUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" title="Open external URL">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      <Link href={`/library/white-papers/${w.id}/edit`}>
                        <Button variant="ghost" size="icon">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(w)}
                          data-testid={`button-delete-white-paper-${w.id}`}
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
