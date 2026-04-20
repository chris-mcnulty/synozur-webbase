import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ExternalLink, Star } from "lucide-react";
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
import { api, type VideoDto } from "@/lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  interview: "Interview",
  webinar: "Webinar",
  demo: "Demo",
  talk: "Talk",
  clip: "Clip",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export default function AdminVideosList() {
  const qc = useQueryClient();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({
    queryKey: ["admin-videos"],
    queryFn: () => api.adminListVideos(),
  });
  const items: VideoDto[] = listQ.data?.items ?? [];

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateVideo>[1] }) =>
      api.updateVideo(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-videos"] }),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteVideo(id),
    onSuccess: () => {
      toast({ title: "Video archived" });
      qc.invalidateQueries({ queryKey: ["admin-videos"] });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const onToggleActive = (v: VideoDto, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: v.id, data: { title: v.title, active } });
  };

  const onToggleFeatured = (v: VideoDto, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: v.id, data: { title: v.title, featured } });
  };

  const onDelete = (v: VideoDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${v.title}"?`)) return;
    deleteMut.mutate(v.id);
  };

  return (
    <AdminLayout
      title="Videos"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Videos" }]}
      actions={
        canWrite && (
          <Link href="/videos/new">
            <Button data-testid="button-create-video">
              <Plus className="h-4 w-4 mr-2" /> New video
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
              <TableHead className="w-32">Category</TableHead>
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
                  No videos yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((v) => (
                <TableRow key={v.id} data-testid={`row-video-${v.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/videos/${v.id}/edit`}>
                      <a
                        className="hover:underline"
                        data-testid={`link-edit-video-${v.id}`}
                      >
                        {v.title}
                      </a>
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">/videos/{v.slug}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {CATEGORY_LABELS[v.category] ?? v.category}
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABELS[v.status] ?? v.status}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleFeatured(v, !v.featured)}
                      disabled={!canWrite}
                      className="inline-flex items-center justify-center"
                      data-testid={`button-toggle-featured-${v.id}`}
                    >
                      <Star
                        className={
                          "h-4 w-4 " +
                          (v.featured
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground")
                        }
                      />
                    </button>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={v.active}
                      onCheckedChange={(next) => onToggleActive(v, next)}
                      disabled={!canWrite}
                      data-testid={`switch-active-${v.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {v.videoUrl && (
                        <a href={v.videoUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" title="Open video URL">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      <Link href={`/videos/${v.id}/edit`}>
                        <Button variant="ghost" size="icon">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(v)}
                          data-testid={`button-delete-video-${v.id}`}
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
