import { Link } from "wouter";
import { Plus, Pencil, Trash2, Star, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
import {
  useCmsListCollateral,
  useCmsUpdateCollateral,
  useCmsDeleteCollateral,
  type CollateralItem,
} from "@workspace/api-client-react";

const TYPE_LABELS: Record<string, string> = {
  webinar: "Webinar",
  white_paper: "White Paper",
  case_study: "Case Study",
  podcast: "Podcast",
  model: "Model",
  training: "Workshop",
  event: "Event",
  insight: "Insight",
};

export default function AdminCollateralList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useCmsListCollateral();
  const items: CollateralItem[] = (listQ.data?.items ?? []) as CollateralItem[];

  const updateMut = useCmsUpdateCollateral({
    mutation: {
      onSuccess: () => listQ.refetch(),
      onError: (e: Error) =>
        toast({ title: "Update failed", description: e.message, variant: "destructive" }),
    },
  });

  const deleteMut = useCmsDeleteCollateral({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item archived" });
        listQ.refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const onToggleActive = (item: CollateralItem, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: item.id,
      data: { type: item.type, title: item.title, active },
    });
  };

  const onToggleFeatured = (item: CollateralItem, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: item.id,
      data: { type: item.type, title: item.title, featured },
    });
  };

  const onChangeRank = (item: CollateralItem, rank: string) => {
    if (!canWrite) return;
    const n = rank === "" ? null : Number(rank);
    if (n !== null && (!Number.isFinite(n) || !Number.isInteger(n))) return;
    updateMut.mutate({
      id: item.id,
      data: { type: item.type, title: item.title, featuredRank: n },
    });
  };

  const onDelete = (item: CollateralItem) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${item.title}"?`)) return;
    deleteMut.mutate({ id: item.id });
  };

  return (
    <AdminLayout
      title="Library"
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Library" }]}
      actions={
        canWrite && (
          <Link href="/admin/collateral/new">
            <Button data-testid="button-create-collateral">
              <Plus className="h-4 w-4 mr-2" /> New item
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
              <TableHead className="w-32">Pillar</TableHead>
              <TableHead className="w-24 text-center">Featured</TableHead>
              <TableHead className="w-24 text-right">Rank</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No library items yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} data-testid={`row-collateral-${item.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/collateral/${item.id}/edit`}>
                      <a
                        className="hover:underline"
                        data-testid={`link-edit-collateral-${item.id}`}
                      >
                        {item.title}
                      </a>
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">/{item.slug}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {TYPE_LABELS[item.type] ?? item.type}
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {item.pillar ?? "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleFeatured(item, !item.featured)}
                      disabled={!canWrite}
                      className="inline-flex items-center justify-center"
                      data-testid={`button-toggle-featured-${item.id}`}
                    >
                      <Star
                        className={
                          "h-4 w-4 " +
                          (item.featured
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground")
                        }
                      />
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      value={item.featuredRank ?? ""}
                      onChange={(e) => onChangeRank(item, e.target.value)}
                      disabled={!canWrite || !item.featured}
                      className="h-7 w-16 text-right inline-block"
                      data-testid={`input-rank-${item.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={item.active}
                      onCheckedChange={(v) => onToggleActive(item, v)}
                      disabled={!canWrite}
                      data-testid={`switch-active-${item.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" title="Open URL">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      <Link href={`/admin/collateral/${item.id}/edit`}>
                        <Button variant="ghost" size="icon">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(item)}
                          data-testid={`button-delete-collateral-${item.id}`}
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
