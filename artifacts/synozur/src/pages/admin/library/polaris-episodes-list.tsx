import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ExternalLink, Download } from "lucide-react";
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
import { PolarisLibsynImportDialog } from "@/components/admin/PolarisLibsynImportDialog";
import { useToast } from "@/hooks/use-toast";
import { api, type PolarisEpisodeDto } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export default function AdminPolarisEpisodesList() {
  const qc = useQueryClient();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;
  const [importOpen, setImportOpen] = useState(false);

  const listQ = useQuery({
    queryKey: ["admin-polaris-episodes"],
    queryFn: () => api.adminListPolarisEpisodes(),
  });
  const items: PolarisEpisodeDto[] = listQ.data?.items ?? [];

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updatePolarisEpisode>[1] }) =>
      api.updatePolarisEpisode(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] }),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deletePolarisEpisode(id),
    onSuccess: () => {
      toast({ title: "Episode archived" });
      qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const onToggleActive = (e: PolarisEpisodeDto, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: e.id,
      data: { title: e.title, episodeNumber: e.episodeNumber, active },
    });
  };

  const onDelete = (e: PolarisEpisodeDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${e.title}"?`)) return;
    deleteMut.mutate(e.id);
  };

  return (
    <AdminLayout
      title="Polaris Episodes"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Polaris" }]}
      actions={
        canWrite && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              data-testid="button-open-libsyn-import"
            >
              <Download className="h-4 w-4 mr-2" /> Import from Libsyn
            </Button>
            <Link href="/library/polaris-episodes/new">
              <Button data-testid="button-create-polaris-episode">
                <Plus className="h-4 w-4 mr-2" /> New episode
              </Button>
            </Link>
          </div>
        )
      }
    >
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-36">Published</TableHead>
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
                  No Polaris episodes yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((e) => (
                <TableRow key={e.id} data-testid={`row-polaris-${e.id}`}>
                  <TableCell className="font-mono">{e.episodeNumber}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/library/polaris-episodes/${e.id}/edit`}>
                      <a className="hover:underline" data-testid={`link-edit-polaris-${e.id}`}>
                        {e.title}
                      </a>
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">
                      /polaris/{e.slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABELS[e.status] ?? e.status}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.publishedAt
                      ? new Date(e.publishedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={e.active}
                      onCheckedChange={(next) => onToggleActive(e, next)}
                      disabled={!canWrite}
                      data-testid={`switch-polaris-active-${e.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {e.audioUrl && (
                        <a href={e.audioUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" title="Open audio URL">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      <Link href={`/library/polaris-episodes/${e.id}/edit`}>
                        <Button variant="ghost" size="icon">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(e)}
                          data-testid={`button-delete-polaris-${e.id}`}
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
      <PolarisLibsynImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </AdminLayout>
  );
}
