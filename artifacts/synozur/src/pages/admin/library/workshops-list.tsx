import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { workshopsApi, type WorkshopDto } from "@/lib/api-workshops";

const LIST_KEY = ["admin-workshops"];

export default function AdminWorkshopsList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({ queryKey: LIST_KEY, queryFn: () => workshopsApi.listAdmin() });
  const items: WorkshopDto[] = listQ.data?.items ?? [];

  const updateMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      workshopsApi.update(id, { active }),
    onSuccess: () => {
      toast({ title: "Workshop updated" });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: ["public-workshops"] });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => workshopsApi.remove(id),
    onSuccess: () => {
      toast({ title: "Workshop archived" });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: ["public-workshops"] });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const toggleActive = (w: WorkshopDto, next: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: w.id, active: next });
  };

  const onDelete = (w: WorkshopDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive workshop "${w.title}"?`)) return;
    deleteMut.mutate(w.id);
  };

  return (
    <AdminLayout
      title="Workshops"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Workshops" }]}
      actions={
        canWrite && (
          <Link href="/library/workshops/new">
            <Button data-testid="button-create-workshop">
              <Plus className="h-4 w-4 mr-2" /> New workshop
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
              <TableHead>Slug</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-20 text-right">Order</TableHead>
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
                  No workshops yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((w) => (
                <TableRow key={w.id} data-testid={`row-workshop-${w.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/library/workshops/${w.id}/edit`}>
                      <a
                        className="hover:underline"
                        data-testid={`link-edit-workshop-${w.id}`}
                      >
                        {w.title}
                      </a>
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    /{w.slug}
                  </TableCell>
                  <TableCell className="text-sm">{w.category || "—"}</TableCell>
                  <TableCell className="text-right text-sm">
                    {w.displayOrder ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={w.active}
                      onCheckedChange={(v) => toggleActive(w, v)}
                      disabled={!canWrite}
                      data-testid={`switch-active-${w.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Link href={`/library/workshops/${w.id}/edit`}>
                        <Button variant="ghost" size="icon">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(w)}
                          data-testid={`button-delete-workshop-${w.id}`}
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
