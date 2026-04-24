import { useMemo, useState } from "react";
import { Link } from "wouter";
import { GripVertical, LayoutGrid, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  useCmsListCollateral,
  type CollateralItem,
} from "@workspace/api-client-react";
import {
  COLLATERAL_TYPE_LABELS,
  HeroThumb,
} from "./_collateral-helpers";

// #120: dedicated admin page for the home-carousel / featured-row curator.
// Split out of the collateral list so editors can focus on order + mix
// without the full browse table in view. Two view modes:
//   - Grid view: large hero tiles, drag-to-reorder, primary mode for visual
//     choreography of the carousel.
//   - Type view: the same featured set grouped by artifact type, for
//     balancing the mix across collateral/video/white-paper/workshop.
// Both modes read from the same server-persisted `featuredRank` and share
// the drag-to-reorder mutation so grid-view reordering updates type-view
// placement and vice versa.

type CollateralRow = CollateralItem & {
  serviceId?: string | null;
  solutionId?: string | null;
};

type ViewMode = "grid" | "type";

// Order types inside the by-type view. Types not in this list fall to the
// end alphabetically by their label.
const TYPE_ORDER: string[] = [
  "white_paper",
  "webinar",
  "case_study",
  "podcast",
  "model",
  "training",
  "event",
  "insight",
  "video",
  "ebook",
];

export default function AdminCarouselPage() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useCmsListCollateral();
  const items: CollateralRow[] = (listQ.data?.items ?? []) as CollateralRow[];

  const [view, setView] = useState<ViewMode>("grid");

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
        .filter((x): x is CollateralRow => !!x);
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

  const handleDropAt = (targetId: string) => {
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

  // By-type grouping — preserves global carousel rank within each group so
  // editors can see "position 1, 4, 7" rather than rank-by-type.
  const byType = useMemo(() => {
    const groups = new Map<string, CollateralRow[]>();
    for (const item of displayOrder) {
      const arr = groups.get(item.type) ?? [];
      arr.push(item);
      groups.set(item.type, arr);
    }
    const sortedTypes = Array.from(groups.keys()).sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a);
      const ib = TYPE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) {
        return (COLLATERAL_TYPE_LABELS[a] ?? a).localeCompare(
          COLLATERAL_TYPE_LABELS[b] ?? b,
        );
      }
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return sortedTypes.map((type) => ({
      type,
      label: COLLATERAL_TYPE_LABELS[type] ?? type,
      items: groups.get(type)!,
    }));
  }, [displayOrder]);

  // Map of item id → global carousel rank (1-based), used as the position
  // chip in the type view.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    displayOrder.forEach((item, idx) => m.set(item.id, idx + 1));
    return m;
  }, [displayOrder]);

  return (
    <AdminLayout
      title="Carousel"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Library", href: "/library/collateral" },
        { label: "Carousel" },
      ]}
      actions={
        <Link href="/library/collateral">
          <Button variant="outline" data-testid="button-back-to-collateral">
            Back to collateral
          </Button>
        </Link>
      }
    >
      <div className="max-w-3xl text-sm text-muted-foreground mb-4">
        Drag to reorder the featured items that power the home carousel and
        the featured-library row. Switch to <strong>By type</strong> to see
        the mix grouped across collateral, video, white paper, and workshop.
        {reordering ? " Saving…" : ""}
      </div>

      <Tabs
        value={view}
        onValueChange={(v) => setView(v as ViewMode)}
        className="w-full"
      >
        <TabsList data-testid="tabs-carousel-view">
          <TabsTrigger value="grid" data-testid="tab-carousel-grid">
            <LayoutGrid className="h-4 w-4 mr-1" /> Grid
          </TabsTrigger>
          <TabsTrigger value="type" data-testid="tab-carousel-type">
            <Layers className="h-4 w-4 mr-1" /> By type
          </TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="mt-4">
          {listQ.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : featuredItems.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
              data-testid="carousel-grid"
            >
              {displayOrder.map((item, idx) => {
                const isDragging = dragId === item.id;
                const isOver = overId === item.id && dragId !== item.id;
                return (
                  <Card
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
                      handleDropAt(item.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    className={
                      "p-3 transition-colors " +
                      (isDragging ? "opacity-50 " : "") +
                      (isOver ? "border-primary bg-primary/5 " : "") +
                      (canWrite && !reordering
                        ? "cursor-grab active:cursor-grabbing"
                        : "cursor-not-allowed")
                    }
                    data-testid={`carousel-card-${item.id}`}
                  >
                    <div className="relative">
                      <HeroThumb url={item.heroImage} title={item.title} size="lg" />
                      <div className="absolute top-1 left-1 bg-background/90 border border-border rounded px-1.5 py-0.5 text-xs font-medium tabular-nums">
                        {idx + 1}
                      </div>
                      <div className="absolute top-1 right-1 bg-background/90 border border-border rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {COLLATERAL_TYPE_LABELS[item.type] ?? item.type}
                      </div>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <Link
                        href={`/library/collateral/${item.id}/edit`}
                        className="flex-1 text-sm font-medium hover:underline line-clamp-2"
                      >
                        {item.title}
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="type" className="mt-4">
          {listQ.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : featuredItems.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-6" data-testid="carousel-by-type">
              {byType.map((group) => (
                <section
                  key={group.type}
                  data-testid={`carousel-type-group-${group.type}`}
                >
                  <div className="flex items-baseline gap-2 mb-2">
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <span className="text-xs text-muted-foreground">
                      {group.items.length} item
                      {group.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {group.items.map((item) => {
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
                            handleDropAt(item.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverId(null);
                          }}
                          className={
                            "flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors " +
                            (isDragging ? "opacity-50 " : "") +
                            (isOver ? "border-primary bg-primary/5 " : "") +
                            (canWrite && !reordering
                              ? "cursor-grab active:cursor-grabbing"
                              : "cursor-not-allowed")
                          }
                          data-testid={`carousel-type-row-${item.id}`}
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span
                            className="w-8 text-xs text-muted-foreground tabular-nums"
                            title="Position in carousel"
                          >
                            #{rankById.get(item.id)}
                          </span>
                          <HeroThumb url={item.heroImage} title={item.title} />
                          <Link
                            href={`/library/collateral/${item.id}/edit`}
                            className="flex-1 font-medium hover:underline truncate"
                          >
                            {item.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function EmptyState() {
  return (
    <Card className="p-8 text-center">
      <h3 className="font-semibold">No featured items yet</h3>
      <p className="text-sm text-muted-foreground mt-1">
        Mark a collateral item as featured from the{" "}
        <Link href="/library/collateral">
          <a className="underline hover:text-foreground">Collateral list</a>
        </Link>{" "}
        to add it to the home carousel.
      </p>
    </Card>
  );
}
