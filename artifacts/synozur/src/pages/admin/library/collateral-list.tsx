import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  ExternalLink,
  GripVertical,
  Search,
  SlidersHorizontal,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { api, type BulkCollateralBody } from "@/lib/api";
import {
  useCmsListCollateral,
  useCmsUpdateCollateral,
  useCmsDeleteCollateral,
  type CollateralItem,
} from "@workspace/api-client-react";

// Server returns serviceId/solutionId; the generated CollateralItem type
// doesn't carry them yet (openapi spec lag — same cast the edit form uses).
type CollateralRow = CollateralItem & {
  serviceId?: string | null;
  solutionId?: string | null;
};

type TypeTab = "all" | NonNullable<CollateralItem["type"]> | "video" | "ebook";

const TYPE_TABS: { value: TypeTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "white_paper", label: "White Paper" },
  { value: "webinar", label: "Webinar" },
  { value: "case_study", label: "Case Study" },
  { value: "podcast", label: "Podcast" },
  { value: "model", label: "Model" },
  { value: "training", label: "Workshop" },
  { value: "event", label: "Event" },
  { value: "insight", label: "Insight" },
  { value: "video", label: "Video" },
  { value: "ebook", label: "eBook" },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_TABS.filter((t) => t.value !== "all").map((t) => [t.value, t.label]),
);

const UNCHANGED = "__unchanged__";
const NONE = "__none__";

type ActiveFilter = "all" | "active" | "inactive";

interface BulkDraft {
  serviceMode: "unchanged" | "set" | "clear";
  serviceId: string;
  solutionMode: "unchanged" | "set" | "clear";
  solutionId: string;
  pillarMode: "unchanged" | "set" | "clear";
  pillar: string;
  activeMode: "unchanged" | "activate" | "deactivate";
  featuredMode: "unchanged" | "feature" | "unfeature";
  tagsMode: "none" | "add" | "remove" | "replace";
  tagsText: string;
}

const EMPTY_BULK: BulkDraft = {
  serviceMode: "unchanged",
  serviceId: "",
  solutionMode: "unchanged",
  solutionId: "",
  pillarMode: "unchanged",
  pillar: "",
  activeMode: "unchanged",
  featuredMode: "unchanged",
  tagsMode: "none",
  tagsText: "",
};

const PILLAR_OPTIONS = [
  { value: "strategic", label: "Strategic" },
  { value: "technology", label: "Technology" },
  { value: "experiences", label: "Experiences" },
  { value: "gtm", label: "Go-to-Market" },
] as const;

// #118: hero thumbnails in the admin list. Append or override `w=128` for
// a 2x-dense 64px tile; URL-hosted images that ignore the query still work
// unchanged.
function heroThumbUrl(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;

  const hashIndex = s.indexOf("#");
  const withoutHash = hashIndex >= 0 ? s.slice(0, hashIndex) : s;
  const hash = hashIndex >= 0 ? s.slice(hashIndex) : "";

  const queryIndex = withoutHash.indexOf("?");
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";

  const params = new URLSearchParams(query);
  params.set("w", "128");

  const nextQuery = params.toString();
  return nextQuery ? `${base}?${nextQuery}${hash}` : `${base}${hash}`;
}

function HeroThumb({ url, title }: { url: string | null | undefined; title: string }) {
  const thumb = heroThumbUrl(url);
  if (!thumb) {
    return (
      <div
        className="flex h-12 w-12 items-center justify-center rounded border border-border bg-muted text-muted-foreground shrink-0"
        aria-label="No hero image"
      >
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={thumb}
      alt={title ? `${title} hero` : "Hero image"}
      loading="lazy"
      decoding="async"
      width={64}
      height={64}
      className="h-12 w-12 rounded border border-border object-cover shrink-0 bg-muted"
    />
  );
}

export default function AdminCollateralList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useCmsListCollateral();
  const items: CollateralRow[] = (listQ.data?.items ?? []) as CollateralRow[];

  const servicesQ = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
  });
  const services = servicesQ.data?.items ?? [];

  const serviceById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.title);
    return m;
  }, [services]);
  const solutionById = useMemo(() => {
    const m = new Map<string, { title: string; serviceId: string | null }>();
    for (const s of services) {
      for (const sol of s.solutions) {
        m.set(sol.id, { title: sol.title, serviceId: s.id });
      }
    }
    return m;
  }, [services]);

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

  // Filter + selection state ------------------------------------------------
  const [tab, setTab] = useState<TypeTab>("all");
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("");
  const [solutionFilter, setSolutionFilter] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<BulkDraft>(EMPTY_BULK);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (tab !== "all" && i.type !== tab) return false;
      if (activeFilter === "active" && !i.active) return false;
      if (activeFilter === "inactive" && i.active) return false;
      if (serviceFilter && i.serviceId !== serviceFilter) return false;
      if (solutionFilter && i.solutionId !== solutionFilter) return false;
      if (q) {
        const hay =
          `${i.title} ${i.slug} ${i.description ?? ""} ${(i.tags ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, tab, search, serviceFilter, solutionFilter, activeFilter]);

  const solutionsForFilter = useMemo(() => {
    if (!serviceFilter) return services.flatMap((s) => s.solutions.map((sol) => ({ ...sol, serviceTitle: s.title })));
    const svc = services.find((s) => s.id === serviceFilter);
    return svc ? svc.solutions.map((sol) => ({ ...sol, serviceTitle: svc.title })) : [];
  }, [services, serviceFilter]);

  const solutionsForBulk = useMemo(() => {
    if (!bulkDraft.serviceId) {
      return services.flatMap((s) => s.solutions.map((sol) => ({ ...sol, serviceTitle: s.title })));
    }
    const svc = services.find((s) => s.id === bulkDraft.serviceId);
    return svc ? svc.solutions.map((sol) => ({ ...sol, serviceTitle: svc.title })) : [];
  }, [services, bulkDraft.serviceId]);

  // Row-level handlers ------------------------------------------------------
  const onToggleActive = (item: CollateralRow, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: item.id,
      data: { type: item.type, title: item.title, active },
    });
  };

  const onToggleFeatured = (item: CollateralRow, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: item.id,
      data: { type: item.type, title: item.title, featured },
    });
  };

  const onChangeRank = (item: CollateralRow, rank: string) => {
    if (!canWrite) return;
    const n = rank === "" ? null : Number(rank);
    if (n !== null && (!Number.isFinite(n) || !Number.isInteger(n))) return;
    updateMut.mutate({
      id: item.id,
      data: { type: item.type, title: item.title, featuredRank: n },
    });
  };

  const onDelete = (item: CollateralRow) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${item.title}"?`)) return;
    deleteMut.mutate({ id: item.id });
  };

  // Selection ---------------------------------------------------------------
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const someVisibleSelected =
    filtered.some((i) => selected.has(i.id)) && !allVisibleSelected;

  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) {
      for (const i of filtered) next.delete(i.id);
    } else {
      for (const i of filtered) next.add(i.id);
    }
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  // Featured reorder --------------------------------------------------------
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

  // Bulk edit ---------------------------------------------------------------
  const MAX_BULK_IDS_PER_REQUEST = 200;

  const openBulk = () => {
    setBulkDraft(EMPTY_BULK);
    setBulkOpen(true);
  };

  const qc = useQueryClient();

  const submitBulk = async () => {
    if (selected.size === 0) return;

    const selectedIds = Array.from(selected);
    const baseBody: Omit<BulkCollateralBody, "ids"> = {};
    const set: NonNullable<BulkCollateralBody["set"]> = {};

    if (bulkDraft.serviceMode === "set" && bulkDraft.serviceId) {
      set.serviceId = bulkDraft.serviceId;
    } else if (bulkDraft.serviceMode === "clear") {
      set.serviceId = null;
    }
    if (bulkDraft.solutionMode === "set" && bulkDraft.solutionId) {
      set.solutionId = bulkDraft.solutionId;
    } else if (bulkDraft.solutionMode === "clear") {
      set.solutionId = null;
    }
    if (bulkDraft.pillarMode === "set" && bulkDraft.pillar) {
      set.pillar = bulkDraft.pillar as NonNullable<BulkCollateralBody["set"]>["pillar"];
    } else if (bulkDraft.pillarMode === "clear") {
      set.pillar = null;
    }
    if (bulkDraft.activeMode === "activate") set.active = true;
    else if (bulkDraft.activeMode === "deactivate") set.active = false;
    if (bulkDraft.featuredMode === "feature") set.featured = true;
    else if (bulkDraft.featuredMode === "unfeature") set.featured = false;

    if (Object.keys(set).length > 0) baseBody.set = set;

    if (bulkDraft.tagsMode !== "none") {
      const tags = bulkDraft.tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tags.length > 0 || bulkDraft.tagsMode === "replace") {
        baseBody.tagsAction = { mode: bulkDraft.tagsMode, tags };
      }
    }

    if (!baseBody.set && !baseBody.tagsAction) {
      toast({
        title: "Nothing to apply",
        description: "Choose at least one change in the dialog.",
        variant: "destructive",
      });
      return;
    }

    setBulkSubmitting(true);
    try {
      let updated = 0;

      for (let i = 0; i < selectedIds.length; i += MAX_BULK_IDS_PER_REQUEST) {
        const ids = selectedIds.slice(i, i + MAX_BULK_IDS_PER_REQUEST);
        const result = await api.bulkUpdateCollateral({ ...baseBody, ids });
        updated += result.updated;
      }

      toast({ title: `Updated ${updated} item${updated === 1 ? "" : "s"}` });
      setBulkOpen(false);
      clearSelection();
      await qc.invalidateQueries({ queryKey: ["/api/cms/collateral"] });
      await qc.invalidateQueries({ queryKey: ["collateral"] });
      await listQ.refetch();
    } catch (e) {
      toast({
        title: "Bulk update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
    }
  };

  const bulkTagValues = useMemo(
    () =>
      bulkDraft.tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [bulkDraft.tagsText],
  );

  const bulkHasChanges =
    bulkDraft.serviceMode !== "unchanged" ||
    bulkDraft.solutionMode !== "unchanged" ||
    bulkDraft.pillarMode !== "unchanged" ||
    bulkDraft.activeMode !== "unchanged" ||
    bulkDraft.featuredMode !== "unchanged" ||
    bulkDraft.tagsMode === "replace" ||
    ((bulkDraft.tagsMode === "add" || bulkDraft.tagsMode === "remove") &&
      bulkTagValues.length > 0);

  // --------------------------------------------------------------------------

  const renderTagBadges = (tags: string[] | null | undefined) => {
    const list = tags ?? [];
    if (list.length === 0) return <span className="text-muted-foreground">—</span>;
    const visible = list.slice(0, 3);
    const extra = list.length - visible.length;
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((t) => (
          <span
            key={t}
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
          >
            {t}
          </span>
        ))}
        {extra > 0 && (
          <span className="text-[10px] text-muted-foreground">+{extra}</span>
        )}
      </div>
    );
  };

  return (
    <AdminLayout
      title="Library"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Library" }]}
      actions={
        canWrite && (
          <Link href="/library/collateral/new">
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
                    (canWrite && !reordering
                      ? "cursor-grab active:cursor-grabbing"
                      : "cursor-not-allowed")
                  }
                  data-testid={`featured-row-${item.id}`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="w-6 text-xs text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <HeroThumb url={item.heroImage} title={item.title} />
                  <Link
                    href={`/library/collateral/${item.id}/edit`}
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

      {/* Type tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TypeTab)} className="w-full">
        <TabsList className="flex-wrap h-auto" data-testid="tabs-collateral-type">
          {TYPE_TABS.map(({ value, label }) => {
            const count =
              value === "all" ? items.length : items.filter((i) => i.type === value).length;
            return (
              <TabsTrigger key={value} value={value} data-testid={`tab-${value}`}>
                {label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, slug, description, or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-collateral-search"
          />
        </div>

        <Select
          value={serviceFilter || NONE}
          onValueChange={(v) => {
            const next = v === NONE ? "" : v;
            setServiceFilter(next);
            // Clear solution if it no longer belongs to the chosen service.
            if (
              solutionFilter &&
              next &&
              solutionById.get(solutionFilter)?.serviceId !== next
            ) {
              setSolutionFilter("");
            }
          }}
        >
          <SelectTrigger className="w-[200px]" data-testid="select-filter-service">
            <SelectValue placeholder="Service: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Service: All</SelectItem>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={solutionFilter || NONE}
          onValueChange={(v) => setSolutionFilter(v === NONE ? "" : v)}
        >
          <SelectTrigger className="w-[220px]" data-testid="select-filter-solution">
            <SelectValue placeholder="Solution: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Solution: All</SelectItem>
            {solutionsForFilter.map((sol) => (
              <SelectItem key={sol.id} value={sol.id}>
                {sol.serviceTitle} — {sol.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={activeFilter}
          onValueChange={(v) => setActiveFilter(v as ActiveFilter)}
        >
          <SelectTrigger className="w-[140px]" data-testid="select-filter-active">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={clearSelection}
              data-testid="button-clear-selection"
            >
              Clear
            </Button>
            {canWrite && (
              <Button
                size="sm"
                onClick={openBulk}
                data-testid="button-bulk-edit"
              >
                <SlidersHorizontal className="h-4 w-4 mr-1" /> Edit selection
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Showing {filtered.length} of {items.length} item{items.length === 1 ? "" : "s"}
      </div>

      <div className="mt-3 rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={
                    allVisibleSelected
                      ? true
                      : someVisibleSelected
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={toggleAllVisible}
                  aria-label="Select all visible"
                  data-testid="checkbox-select-all"
                />
              </TableHead>
              <TableHead className="w-16">Hero</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-40">Service</TableHead>
              <TableHead className="w-40">Solution</TableHead>
              <TableHead className="w-24">Pillar</TableHead>
              <TableHead className="w-40">Tags</TableHead>
              <TableHead className="w-20 text-center">Featured</TableHead>
              <TableHead className="w-20 text-right">Rank</TableHead>
              <TableHead className="w-16">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  {items.length === 0
                    ? "No library items yet."
                    : "No items match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const svcTitle = item.serviceId
                  ? (serviceById.get(item.serviceId) ?? "—")
                  : "—";
                const solTitle = item.solutionId
                  ? (solutionById.get(item.solutionId)?.title ?? "—")
                  : "—";
                return (
                  <TableRow key={item.id} data-testid={`row-collateral-${item.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleOne(item.id)}
                        aria-label={`Select ${item.title}`}
                        data-testid={`checkbox-select-${item.id}`}
                      />
                    </TableCell>
                    <TableCell data-testid={`thumb-collateral-${item.id}`}>
                      <HeroThumb url={item.heroImage} title={item.title} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/library/collateral/${item.id}/edit`}>
                        <a
                          className="hover:underline"
                          data-testid={`link-edit-collateral-${item.id}`}
                        >
                          {item.title}
                        </a>
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">
                        /{item.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {TYPE_LABELS[item.type] ?? item.type}
                    </TableCell>
                    <TableCell className="text-sm">{svcTitle}</TableCell>
                    <TableCell className="text-sm">{solTitle}</TableCell>
                    <TableCell className="text-sm capitalize">
                      {item.pillar ?? "—"}
                    </TableCell>
                    <TableCell>{renderTagBadges(item.tags)}</TableCell>
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
                        <Link href={`/library/collateral/${item.id}/edit`}>
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
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Bulk edit dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && setBulkOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Edit {selected.size} item{selected.size === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Fields left on &ldquo;Leave unchanged&rdquo; will not be modified. Tag actions merge
            with each item&rsquo;s existing tags.
          </p>

          <div className="space-y-4">
            {/* Service */}
            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>Service</Label>
              <div className="flex gap-2">
                <Select
                  value={
                    bulkDraft.serviceMode === "unchanged"
                      ? UNCHANGED
                      : bulkDraft.serviceMode === "clear"
                        ? NONE
                        : bulkDraft.serviceId || UNCHANGED
                  }
                  onValueChange={(v) => {
                    if (v === UNCHANGED) {
                      setBulkDraft((d) => ({
                        ...d,
                        serviceMode: "unchanged",
                        serviceId: "",
                      }));
                    } else if (v === NONE) {
                      setBulkDraft((d) => ({
                        ...d,
                        serviceMode: "clear",
                        serviceId: "",
                        // If solution was tied to a service, clear it too.
                        ...(d.solutionMode === "set" ? { solutionMode: "clear", solutionId: "" } : {}),
                      }));
                    } else {
                      setBulkDraft((d) => ({
                        ...d,
                        serviceMode: "set",
                        serviceId: v,
                        // Drop solution if it no longer belongs to this service.
                        ...(d.solutionMode === "set" &&
                        d.solutionId &&
                        solutionById.get(d.solutionId)?.serviceId !== v
                          ? { solutionId: "" }
                          : {}),
                      }));
                    }
                  }}
                >
                  <SelectTrigger data-testid="bulk-service">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNCHANGED}>Leave unchanged</SelectItem>
                    <SelectItem value={NONE}>Clear (no service)</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Solution */}
            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>Solution</Label>
              <Select
                value={
                  bulkDraft.solutionMode === "unchanged"
                    ? UNCHANGED
                    : bulkDraft.solutionMode === "clear"
                      ? NONE
                      : bulkDraft.solutionId || UNCHANGED
                }
                onValueChange={(v) => {
                  if (v === UNCHANGED) {
                    setBulkDraft((d) => ({
                      ...d,
                      solutionMode: "unchanged",
                      solutionId: "",
                    }));
                  } else if (v === NONE) {
                    setBulkDraft((d) => ({
                      ...d,
                      solutionMode: "clear",
                      solutionId: "",
                    }));
                  } else {
                    setBulkDraft((d) => ({
                      ...d,
                      solutionMode: "set",
                      solutionId: v,
                    }));
                  }
                }}
              >
                <SelectTrigger data-testid="bulk-solution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCHANGED}>Leave unchanged</SelectItem>
                  <SelectItem value={NONE}>Clear (no solution)</SelectItem>
                  {solutionsForBulk.map((sol) => (
                    <SelectItem key={sol.id} value={sol.id}>
                      {sol.serviceTitle} — {sol.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Pillar */}
            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>Pillar</Label>
              <Select
                value={
                  bulkDraft.pillarMode === "unchanged"
                    ? UNCHANGED
                    : bulkDraft.pillarMode === "clear"
                      ? NONE
                      : bulkDraft.pillar || UNCHANGED
                }
                onValueChange={(v) => {
                  if (v === UNCHANGED) {
                    setBulkDraft((d) => ({ ...d, pillarMode: "unchanged", pillar: "" }));
                  } else if (v === NONE) {
                    setBulkDraft((d) => ({ ...d, pillarMode: "clear", pillar: "" }));
                  } else {
                    setBulkDraft((d) => ({ ...d, pillarMode: "set", pillar: v }));
                  }
                }}
              >
                <SelectTrigger data-testid="bulk-pillar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCHANGED}>Leave unchanged</SelectItem>
                  <SelectItem value={NONE}>Clear (no pillar)</SelectItem>
                  {PILLAR_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Active */}
            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>Active</Label>
              <Select
                value={bulkDraft.activeMode}
                onValueChange={(v) =>
                  setBulkDraft((d) => ({
                    ...d,
                    activeMode: v as BulkDraft["activeMode"],
                  }))
                }
              >
                <SelectTrigger data-testid="bulk-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">Leave unchanged</SelectItem>
                  <SelectItem value="activate">Activate</SelectItem>
                  <SelectItem value="deactivate">Deactivate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Featured */}
            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <Label>Featured</Label>
              <Select
                value={bulkDraft.featuredMode}
                onValueChange={(v) =>
                  setBulkDraft((d) => ({
                    ...d,
                    featuredMode: v as BulkDraft["featuredMode"],
                  }))
                }
              >
                <SelectTrigger data-testid="bulk-featured">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">Leave unchanged</SelectItem>
                  <SelectItem value="feature">Mark featured</SelectItem>
                  <SelectItem value="unfeature">Unmark featured</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="grid grid-cols-[120px_1fr] items-start gap-3">
              <Label className="pt-2">Tags</Label>
              <div className="space-y-2">
                <Select
                  value={bulkDraft.tagsMode}
                  onValueChange={(v) =>
                    setBulkDraft((d) => ({
                      ...d,
                      tagsMode: v as BulkDraft["tagsMode"],
                    }))
                  }
                >
                  <SelectTrigger data-testid="bulk-tags-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Leave unchanged</SelectItem>
                    <SelectItem value="add">Add tags</SelectItem>
                    <SelectItem value="remove">Remove tags</SelectItem>
                    <SelectItem value="replace">Replace all tags</SelectItem>
                  </SelectContent>
                </Select>
                {bulkDraft.tagsMode !== "none" && (
                  <Input
                    placeholder="comma, separated, tags"
                    value={bulkDraft.tagsText}
                    onChange={(e) =>
                      setBulkDraft((d) => ({ ...d, tagsText: e.target.value }))
                    }
                    data-testid="bulk-tags-input"
                  />
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(false)}
              disabled={bulkSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={submitBulk}
              disabled={bulkSubmitting || !bulkHasChanges}
              data-testid="button-bulk-apply"
            >
              {bulkSubmitting ? "Applying…" : `Apply to ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
