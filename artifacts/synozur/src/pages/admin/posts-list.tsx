import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Plus, Search, Trash2, Pencil, Archive, BarChart2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  useListCmsPosts,
  useDeleteCmsPost,
  useArchiveCmsPost,
  useGetCmsBatchViews,
  type Post,
  type PostStatus,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

function statusBadge(s: PostStatus) {
  const map: Record<PostStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    scheduled: "bg-blue-500/15 text-blue-300",
    published: "bg-emerald-500/15 text-emerald-300",
    archived: "bg-amber-500/15 text-amber-300",
  };
  return (
    <span className={`text-xs uppercase tracking-wide px-2 py-1 rounded ${map[s]}`}>
      {s}
    </span>
  );
}

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type SortDir = "asc" | "desc";

export default function AdminPostsList() {
  const { toast } = useToast();
  const { access } = useAdminAccess();

  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewsSort, setViewsSort] = useState<SortDir | null>(null);

  const { data: postsData, isLoading, refetch } = useListCmsPosts(
    {
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      page,
      pageSize: 20,
    },
    { query: { enabled: !!access?.hasCmsRole } as never },
  );

  const deletePost = useDeleteCmsPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post deleted" });
        refetch();
      },
      onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const archivePost = useArchiveCmsPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post archived" });
        refetch();
      },
      onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
    },
  });

  const rawItems: Post[] = postsData?.items ?? [];
  const total = postsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const publishedIds = rawItems
    .filter((p) => p.status === "published")
    .map((p) => p.id);

  const { data: batchViewsData } = useGetCmsBatchViews(
    { postIds: publishedIds.join(","), days: 30 },
    {
      query: {
        enabled: publishedIds.length > 0 && !!access?.hasCmsRole,
      } as never,
    },
  );

  const viewsMap: Record<string, number> = batchViewsData?.views ?? {};

  const items = useMemo(() => {
    if (viewsSort === null) return rawItems;
    return [...rawItems].sort((a, b) => {
      const va = a.status === "published" ? (viewsMap[a.id] ?? 0) : -1;
      const vb = b.status === "published" ? (viewsMap[b.id] ?? 0) : -1;
      return viewsSort === "desc" ? vb - va : va - vb;
    });
  }, [rawItems, viewsMap, viewsSort]);

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((p) => p.id)));
  };

  const toggleOne = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} post(s)? This cannot be undone.`)) return;
    for (const id of selected) {
      await deletePost.mutateAsync({ id });
    }
    setSelected(new Set());
  };

  const bulkArchive = async () => {
    if (!confirm(`Archive ${selected.size} post(s)?`)) return;
    for (const id of selected) {
      await archivePost.mutateAsync({ id });
    }
    setSelected(new Set());
  };

  return (
    <AdminLayout
      title="Posts"
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Posts" }]}
      actions={
        <Link href="/admin/posts/new">
          <Button data-testid="button-create-post">
            <Plus className="h-4 w-4 mr-2" /> New post
          </Button>
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title or slug…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              // simple debounce inline
              window.clearTimeout((window as unknown as { __searchT?: number }).__searchT);
              (window as unknown as { __searchT?: number }).__searchT = window.setTimeout(
                () => setDebouncedSearch(e.target.value),
                300,
              );
            }}
            className="pl-9"
            data-testid="input-post-search"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as PostStatus | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            {access?.isEditorOrAbove && (
              <Button variant="outline" size="sm" onClick={bulkArchive} data-testid="button-bulk-archive">
                <Archive className="h-4 w-4 mr-1" /> Archive
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={bulkDelete} data-testid="button-bulk-delete">
              <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={items.length > 0 && selected.size === items.length}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Categories</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead
                className="cursor-pointer select-none whitespace-nowrap"
                onClick={() =>
                  setViewsSort((prev) =>
                    prev === "desc" ? "asc" : "desc",
                  )
                }
                data-testid="th-views"
              >
                <span className="inline-flex items-center gap-1">
                  Views (30d)
                  {viewsSort === "desc" ? (
                    <ArrowDown className="h-3 w-3" />
                  ) : viewsSort === "asc" ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                  )}
                </span>
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No posts match these filters.
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id} data-testid={`row-post-${p.id}`}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      aria-label={`Select ${p.title}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/admin/posts/${p.id}/edit`}>
                      <a className="hover:underline">{p.title}</a>
                    </Link>
                    <div className="text-xs text-muted-foreground">/{p.slug}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.author?.displayName ?? "—"}
                  </TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(p.categories ?? []).map((c) => c.name).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(p.publishedAt)}</TableCell>
                  <TableCell className="text-sm">{formatDate(p.updatedAt)}</TableCell>
                  <TableCell className="text-sm tabular-nums" data-testid={`views-${p.id}`}>
                    {p.status === "published"
                      ? (viewsMap[p.id] ?? 0).toLocaleString()
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {p.status === "published" && (
                        <Link href={`/admin/posts/${p.id}/analytics`}>
                          <Button variant="ghost" size="icon" title="Analytics" data-testid={`button-analytics-${p.id}`}>
                            <BarChart2 className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                      <Link href={`/admin/posts/${p.id}/edit`}>
                        <Button variant="ghost" size="icon" data-testid={`button-edit-${p.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete "${p.title}"?`)) {
                            deletePost.mutate({ id: p.id });
                          }
                        }}
                        data-testid={`button-delete-${p.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {page} of {totalPages} · {total} total
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
