import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, Star, ExternalLink, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
import { api } from "@/lib/api";
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

  const featuredItems = useMemo(
    () =>
      items
        .filter((i) => i.featured)
        .slice()
        .sort((a, b) => {
          const ra = a.featuredRank ?? Number.POSITIVE_INFINITY;
          const rb = b.featuredRank ?? Number.POSITIVE_INFINITY;
          if (ra !== rb) return ra - rb;
          return a.title.localeCompare(b.title);
        }),
    [items],
  );

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [reordering, setReordering] = useState(false);

  const displayOrder = useMemo(() => {
    if (localOrder) {
      const byId = new Map(featuredItems.map((f) => [f.id, f]));
      const ordered = localOrder
        .map((id) => byId.get(id))
        .filter((x): x is CollateralItem => !!x);
      const extras = featuredItems.filter((f) => !localOrder.includes(f.id));
      return [...ordered, ...extras];
    }
    return featuredItems;
  }, [featuredItems, localOrder]);

  const commitReorder = async (newIds: string[]) => {
    setLocalOrder(newIds);
    setReordering(true);
    try {
      await api.reorderFeaturedCollateral(newIds);
      toast({ title: "Order saved" });
      await listQ.refetch();
      setLocalOrder(null);
    } catch (e) {
      toast({
        title: "Reorder failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setLocalOrder(null);
    } finally {
      setReordering(false);
    }
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const currentIds = displayOrder.map((f) => f.id);
    const from = currentIds.indexOf(dragId);
    const to = currentIds.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const next = currentIds.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    setOverId(null);
    void commitReorder(next);
  };

  return (
    <AdminLayout
      title="Library"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Library" }]}
      actions={
        canWrite && (
          <Link href="/collateral/new">
            <Button data-testid="button-create-collateral">
              <Plus className="h-4 w-4 mr-2" /> New item
            </Button>
          </Link>
        )
      }
    >
      {featuredItems.length > 0 && (
        <Card className="mb-6 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Featured items</h3>
              <p className="text-xs text-muted-foreground">
                Drag to reorder the home carousel and featured library row.
                {reordering ? " Saving…" : ""}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {featuredItems.length} item{featuredItems.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="space-y-1" data-testid="featured-reorder-list">
            {displayOrder.map((item, idx) => {
              const isDragging = dragId === item.id;
              const isOver = overId === item.id && dragId !== item.id;
              return (
                <li
                  key={item.id}
                  draggable={canWrite && !reordering}
                  onDragStart={(e) => {
                    if (!canWrite || reordering) return;
                    setDragId(item.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overId !== item.id) setOverId(item.id);
                  }}
                  onDragLeave={() => {
                    if (overId === item.id) setOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(item.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  className={
                    "flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors " +
                    (isDragging ? "opacity-50 " : "") +
                    (isOver ? "border-primary bg-primary/5 " : "") +
                    (canWrite && !reordering ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed")
                  }
                  data-testid={`featured-row-${item.id}`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="w-6 text-xs text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <Link
                    href={`/collateral/${item.id}/edit`}
                    className="flex-1 font-medium hover:underline truncate"
                  >
                    {item.title}
                  </Link>
                  <span className="text-xs text-muted-foreground capitalize">
                    {TYPE_LABELS[item.type] ?? item.type}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

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
                    <Link href={`/collateral/${item.id}/edit`}>
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
                      <Link href={`/collateral/${item.id}/edit`}>
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
