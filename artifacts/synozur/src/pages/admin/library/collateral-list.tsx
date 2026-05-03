import { useMemo, useState } from "react";
import { AppLink } from "@/components/ui/app-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  ExternalLink,
  Search,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Lock,
  ShieldCheck,
  GripVertical,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
  useCmsReorderCollateral,
  type CollateralItem,
} from "@workspace/api-client-react";
import {
  COLLATERAL_TYPE_TABS,
  COLLATERAL_TYPE_LABELS,
  HeroThumb,
  editorPathForSource,
} from "./_collateral-helpers";

// Alias with the extra fields now included in CollateralItem (formerly needed
// a manual cast due to openapi spec lag; kept as a named alias for clarity).
type CollateralRow = CollateralItem & {
  serviceId?: string | null;
  solutionId?: string | null;
  sourceId?: string | null;
};

type TypeTab = "all" | NonNullable<CollateralItem["type"]> | "video" | "ebook";

// #121: columns the admin can sort by. Split across two origins:
// - Server-side (`server`): forwarded to the backend `sort` query param.
//   Backend validates against its own allow-list, so this list must stay
//   in sync with SortableCmsCollateralColumns in routes/collateral.ts.
// - Client-side (`client`): derived display values that live only in the
//   frontend (service/solution titles are looked up from the services
//   API). Sorting these would require JOINs on the server; for now we
//   sort client-side against the already-loaded items.
type SortCol =
  | "title"
  | "type"
  | "service"
  | "solution"
  | "pillar"
  | "featured"
  | "featuredRank"
  | "updatedAt";
type SortDir = "asc" | "desc";

const SORT_ORIGIN: Record<SortCol, "server" | "client"> = {
  title: "server",
  type: "server",
  pillar: "server",
  featured: "server",
  featuredRank: "server",
  updatedAt: "server",
  service: "client",
  solution: "client",
};

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

// #121: click cycles asc → desc → cleared. `current` is the active column on
// the page; when it doesn't match `col`, the icon shows the neutral double
// arrow so editors can see the column is sortable but not yet active.
function SortHeader({
  col,
  label,
  current,
  dir,
  onChange,
  className,
  align = "left",
}: {
  col: SortCol;
  label: string;
  current: SortCol | null;
  dir: SortDir;
  onChange: (col: SortCol | null, dir: SortDir) => void;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const active = current === col;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;

  const cycle = () => {
    if (!active) {
      onChange(col, "asc");
      return;
    }
    if (dir === "asc") {
      onChange(col, "desc");
      return;
    }
    onChange(null, "asc");
  };

  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <TableHead
      className={className}
      aria-sort={!active ? "none" : dir === "asc" ? "ascending" : "descending"}
    >
      <button
        type="button"
        onClick={cycle}
        className={`group inline-flex items-center gap-1 select-none ${justify} w-full hover:text-foreground`}
        data-testid={`th-sort-${col}`}
      >
        <span>{label}</span>
        <Icon
          className={
            "h-3 w-3 shrink-0 " +
            (active ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground")
          }
        />
      </button>
    </TableHead>
  );
}

export default function AdminCollateralList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  // Sort state (#121) — null means fall back to the default server order.
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const serverSortParam =
    sortCol && SORT_ORIGIN[sortCol] === "server"
      ? `${sortCol}:${sortDir}`
      : undefined;

  const listQ = useCmsListCollateral(
    serverSortParam ? { sort: serverSortParam } : undefined,
  );
  const items: CollateralRow[] = (listQ.data?.items ?? []) as CollateralRow[];

  const servicesQ = useQuery({
    queryKey: ["admin-services-with-solutions"],
    queryFn: () => api.listServicesAdmin(),
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

  // Reorder mode (#75): when active the table shows only featured rows in
  // featured-rank order with drag handles; the new order is held locally
  // until the editor saves it as a single bulk request.
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderIds, setReorderIds] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reorderMut = useCmsReorderCollateral({
    mutation: {
      onSuccess: async () => {
        toast({ title: "Featured order saved" });
        setReorderMode(false);
        setReorderIds(null);
        await listQ.refetch();
      },
      onError: (e: Error) =>
        toast({
          title: "Reorder failed",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  // Featured items in their current carousel order. Used by reorder mode.
  const featuredOrdered = useMemo(
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

  const reorderRows = useMemo(() => {
    if (!reorderIds) return featuredOrdered;
    const byId = new Map(featuredOrdered.map((f) => [f.id, f]));
    const ordered = reorderIds
      .map((id) => byId.get(id))
      .filter((x): x is CollateralRow => !!x);
    const extras = featuredOrdered.filter((f) => !reorderIds.includes(f.id));
    return [...ordered, ...extras];
  }, [featuredOrdered, reorderIds]);

  const reorderDirty =
    !!reorderIds &&
    (reorderIds.length !== featuredOrdered.length ||
      reorderIds.some((id, i) => featuredOrdered[i]?.id !== id));

  const handleReorderDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const currentIds = reorderRows.map((r) => r.id);
    const from = currentIds.indexOf(dragId);
    const to = currentIds.indexOf(targetId);
    setDragId(null);
    setOverId(null);
    if (from < 0 || to < 0) return;
    const next = currentIds.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setReorderIds(next);
  };

  const enterReorderMode = () => {
    setReorderMode(true);
    setReorderIds(featuredOrdered.map((f) => f.id));
    clearSelection();
  };

  const cancelReorder = () => {
    setReorderMode(false);
    setReorderIds(null);
    setDragId(null);
    setOverId(null);
  };

  const saveReorder = () => {
    const ids = reorderRows.map((r) => r.id);
    if (ids.length === 0) return;
    reorderMut.mutate({ data: { ids } });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = items.filter((i) => {
      // The "white_paper" tab also includes ebooks — both are stored in
      // the white_papers source table (distinguished by docType), so an
      // editor expects to see them together when viewing whitepapers.
      if (tab !== "all") {
        const matches =
          i.type === tab ||
          (tab === "white_paper" && i.type === "ebook") ||
          // "training" tab also shows synced workshop items (same concept,
          // two type values coexist while we migrate).
          (tab === "training" && i.type === "workshop");
        if (!matches) return false;
      }
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

    // Client-side sort for derived columns (service/solution titles). All
    // other columns are sorted server-side, so we keep the returned order.
    if (sortCol && SORT_ORIGIN[sortCol] === "client") {
      const sign = sortDir === "desc" ? -1 : 1;
      const keyFor = (row: CollateralRow) => {
        if (sortCol === "service") {
          return row.serviceId ? (serviceById.get(row.serviceId) ?? "") : "";
        }
        return row.solutionId
          ? (solutionById.get(row.solutionId)?.title ?? "")
          : "";
      };
      return base.slice().sort((a, b) => {
        const ka = keyFor(a).toLowerCase();
        const kb = keyFor(b).toLowerCase();
        if (ka === kb) return a.title.localeCompare(b.title);
        // Empty strings go last regardless of direction.
        if (!ka) return 1;
        if (!kb) return -1;
        return sign * ka.localeCompare(kb);
      });
    }

    return base;
  }, [
    items,
    tab,
    search,
    serviceFilter,
    solutionFilter,
    activeFilter,
    sortCol,
    sortDir,
    serviceById,
    solutionById,
  ]);

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
      data: { active } as Parameters<typeof updateMut.mutate>[0]["data"],
    });
  };

  const onToggleFeatured = (item: CollateralRow, featured: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: item.id,
      // Send only the curation field being changed. Sending content fields
      // (type, title, etc.) alongside curation fields causes a 400 on synced
      // rows where those fields are read-only at source.
      data: { featured } as Parameters<typeof updateMut.mutate>[0]["data"],
    });
  };

  const onChangeRank = (item: CollateralRow, rank: string) => {
    if (!canWrite) return;
    const n = rank === "" ? null : Number(rank);
    if (n !== null && (!Number.isFinite(n) || !Number.isInteger(n))) return;
    updateMut.mutate({
      id: item.id,
      // Same as above — only send the curation field being changed.
      data: { featuredRank: n } as Parameters<typeof updateMut.mutate>[0]["data"],
    });
  };

  const onDelete = (item: CollateralRow) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${item.title}"? This will remove it from the public site.`)) return;
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

  // #120: featured-items drag-to-reorder moved to its own admin page at
  // /admin/library/carousel so this list stays focused on browsing/editing.

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
        <div className="flex items-center gap-2">
          {reorderMode ? (
            <>
              <Button
                variant="outline"
                onClick={cancelReorder}
                disabled={reorderMut.isPending}
                data-testid="button-reorder-cancel"
              >
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
              <Button
                onClick={saveReorder}
                disabled={!reorderDirty || reorderMut.isPending}
                data-testid="button-reorder-save"
              >
                <Check className="h-4 w-4 mr-2" />
                {reorderMut.isPending ? "Saving…" : "Save order"}
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="outline" data-testid="button-library-audit">
                <AppLink href="/library/audit" asChild unstyled>
                  <ShieldCheck className="h-4 w-4 mr-2" /> Audit library
                </AppLink>
              </Button>
              {canWrite && featuredOrdered.length > 1 && (
                <Button
                  variant="outline"
                  onClick={enterReorderMode}
                  data-testid="button-reorder-featured"
                >
                  <GripVertical className="h-4 w-4 mr-2" /> Reorder featured
                </Button>
              )}
              {canWrite && (
                <Button asChild data-testid="button-create-collateral">
                  <AppLink href="/library/collateral/new" asChild unstyled>
                    <Plus className="h-4 w-4 mr-2" /> New item
                  </AppLink>
                </Button>
              )}
            </>
          )}
        </div>
      }
    >
      {reorderMode && (
        <div className="mb-4" data-testid="reorder-panel">
          <div className="text-sm text-muted-foreground mb-3">
            Drag to reorder the featured items that power the home carousel and
            the featured-library row. Click <strong>Save order</strong> to apply
            all changes in one update.
            {reorderMut.isPending ? " Saving…" : ""}
          </div>
          {featuredOrdered.length === 0 ? (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              No featured items yet. Mark items as featured from the list to
              add them to the home carousel.
            </div>
          ) : (
            <ul className="space-y-1" data-testid="reorder-list">
              {reorderRows.map((item, idx) => {
                const isDragging = dragId === item.id;
                const isOver = overId === item.id && dragId !== item.id;
                const draggable = canWrite && !reorderMut.isPending;
                return (
                  // Native HTML5 DnD reorder region; mouse-only listeners on a
                  // non-interactive list item.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                  <li
                    key={item.id}
                    draggable={draggable}
                    onDragStart={(e) => {
                      if (!draggable) return;
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
                      handleReorderDrop(item.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    className={
                      "flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors " +
                      (isDragging ? "opacity-50 " : "") +
                      (isOver ? "border-primary bg-primary/5 " : "") +
                      (draggable
                        ? "cursor-grab active:cursor-grabbing"
                        : "cursor-not-allowed")
                    }
                    data-testid={`reorder-row-${item.id}`}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span
                      className="w-8 text-xs text-muted-foreground tabular-nums"
                      title="New rank"
                    >
                      #{idx + 1}
                    </span>
                    <HeroThumb url={item.heroImage} title={item.title} />
                    <span className="flex-1 font-medium truncate">
                      {item.title}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {COLLATERAL_TYPE_LABELS[item.type] ?? item.type}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!reorderMode && (
      <>
      {/* Type tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TypeTab)} className="w-full">
        <TabsList className="flex-wrap h-auto" data-testid="tabs-collateral-type">
          {COLLATERAL_TYPE_TABS.map(({ value, label }) => {
            // Mirror the same widening for the "white_paper" tab here so
            // its count badge matches the rows actually shown.
            const count =
              value === "all"
                ? items.length
                : items.filter(
                    (i) =>
                      i.type === value ||
                      (value === "white_paper" && i.type === "ebook") ||
                      (value === "training" && i.type === "workshop"),
                  ).length;
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
              <SortHeader
                col="title"
                label="Title"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
              />
              <SortHeader
                col="type"
                label="Type"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
                className="w-28"
              />
              <SortHeader
                col="service"
                label="Service"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
                className="w-40"
              />
              <SortHeader
                col="solution"
                label="Solution"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
                className="w-40"
              />
              <SortHeader
                col="pillar"
                label="Pillar"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
                className="w-24"
              />
              <TableHead className="w-40">Tags</TableHead>
              <SortHeader
                col="featured"
                label="Featured"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
                className="w-24 text-center"
                align="center"
              />
              <SortHeader
                col="featuredRank"
                label="Rank"
                current={sortCol}
                dir={sortDir}
                onChange={(c, d) => {
                  setSortCol(c);
                  setSortDir(d);
                }}
                className="w-20 text-right"
                align="right"
              />
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
                      <AppLink
                        href={
                          editorPathForSource(item.sourceId) ??
                          `/library/collateral/${item.id}/edit`
                        }
                        asChild
                        className="inline-flex items-center gap-1.5"
                        data-testid={`link-edit-collateral-${item.id}`}
                      >
                        {item.sourceId && (
                          <Lock
                            className="h-3 w-3 text-blue-400"
                            aria-label="Synced from source — edit at source"
                          />
                        )}
                        <span>{item.title}</span>
                      </AppLink>
                      <div className="text-xs text-muted-foreground font-mono">
                        /{item.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {COLLATERAL_TYPE_LABELS[item.type] ?? item.type}
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
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          title={
                            item.sourceId
                              ? "Edit content at the source"
                              : "Edit"
                          }
                        >
                          <AppLink
                            href={
                              editorPathForSource(item.sourceId) ??
                              `/library/collateral/${item.id}/edit`
                            }
                            asChild
                            unstyled
                          >
                            <Pencil className="h-4 w-4" />
                          </AppLink>
                        </Button>
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
      </>
      )}

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
