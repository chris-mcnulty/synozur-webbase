import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Plus, Search, Trash2, Pencil, Archive, BarChart2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ListCmsPostsSortBy,
  ListCmsPostsSortDir,
  type Post,
  type PostStatus,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

type TabValue = "published" | "draft" | "scheduled" | "archived";
type ApiSortBy = "title" | "author" | "publishedAt" | "updatedAt";
type SortDir = "asc" | "desc";

const TAB_LABELS: { value: TabValue; label: string }[] = [
  { value: "published", label: "Published" },
  { value: "scheduled", label: "Scheduled" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SortIcon({ field: _field, active, dir }: { field: string; active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

export default function AdminPostsList() {
  const { toast } = useToast();
  const { access } = useAdminAccess();

  const [tab, setTab] = useState<TabValue>("published");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [sortBy, setSortBy] = useState<ApiSortBy>("publishedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewsSort, setViewsSort] = useState<SortDir | null>(null);

  const { data: postsData, isLoading, refetch } = useListCmsPosts(
    {
      status: tab as PostStatus,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      page,
      pageSize: 20,
      sortBy: sortBy as typeof ListCmsPostsSortBy[keyof typeof ListCmsPostsSortBy],
      sortDir: sortDir as typeof ListCmsPostsSortDir[keyof typeof ListCmsPostsSortDir],
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

  const handleApiSort = (field: ApiSortBy) => {
    setViewsSort(null);
    if (sortBy === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const handleViewsSort = () => {
    setViewsSort((prev) => (prev === "desc" ? "asc" : "desc"));
  };

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
    if (!confirm(`Archive ${selected.size} post(s)? This will remove them from the public site.`)) return;
    for (const id of selected) {
      await archivePost.mutateAsync({ id });
    }
    setSelected(new Set());
  };

  const handleTabChange = (value: string) => {
    setTab(value as TabValue);
    setPage(1);
    setSelected(new Set());
    setViewsSort(null);
    setSortBy("publishedAt");
    setSortDir("desc");
  };

  const colCount = tab === "published" ? 8 : 7;

  return (
    <AdminLayout
      title="Posts"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Posts" }]}
      actions={
        <Link href="/insights/posts/new">
          <Button data-testid="button-create-post">
            <Plus className="h-4 w-4 mr-2" /> New post
          </Button>
        </Link>
      }
    >
      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <TabsList data-testid="tabs-status">
            {TAB_LABELS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} data-testid={`tab-${value}`}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search title or slug…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
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
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleApiSort("title")}
                  data-testid="th-title"
                >
                  <span className="inline-flex items-center gap-1">
                    Title
                    <SortIcon field="title" active={sortBy === "title" && viewsSort === null} dir={sortDir} />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleApiSort("author")}
                  data-testid="th-author"
                >
                  <span className="inline-flex items-center gap-1">
                    Author
                    <SortIcon field="author" active={sortBy === "author" && viewsSort === null} dir={sortDir} />
                  </span>
                </TableHead>
                <TableHead>Categories</TableHead>
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap"
                  onClick={() => handleApiSort("publishedAt")}
                  data-testid="th-published"
                >
                  <span className="inline-flex items-center gap-1">
                    Published
                    <SortIcon field="publishedAt" active={sortBy === "publishedAt" && viewsSort === null} dir={sortDir} />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none whitespace-nowrap"
                  onClick={() => handleApiSort("updatedAt")}
                  data-testid="th-updated"
                >
                  <span className="inline-flex items-center gap-1">
                    Updated
                    <SortIcon field="updatedAt" active={sortBy === "updatedAt" && viewsSort === null} dir={sortDir} />
                  </span>
                </TableHead>
                {tab === "published" && (
                  <TableHead
                    className="cursor-pointer select-none whitespace-nowrap"
                    onClick={handleViewsSort}
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
                )}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                    No {tab} posts.
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
                      <Link
                        href={`/insights/posts/${p.id}/edit`}
                        className="hover:underline"
                      >
                        {p.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">/{p.slug}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.author?.displayName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(p.categories ?? []).map((c) => c.name).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(p.publishedAt)}</TableCell>
                    <TableCell className="text-sm">{formatDate(p.updatedAt)}</TableCell>
                    {tab === "published" && (
                      <TableCell className="text-sm tabular-nums" data-testid={`views-${p.id}`}>
                        {(viewsMap[p.id] ?? 0).toLocaleString()}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {p.status === "published" && (
                          <Link href={`/insights/posts/${p.id}/analytics`}>
                            <Button variant="ghost" size="icon" title="Analytics" data-testid={`button-analytics-${p.id}`}>
                              <BarChart2 className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
                        <Link href={`/insights/posts/${p.id}/edit`}>
                          <Button variant="ghost" size="icon" data-testid={`button-edit-${p.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm(`Delete "${p.title}"? This cannot be undone.`)) {
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
            {total > 0
              ? `Showing page ${page} of ${totalPages} · ${total} total`
              : `No ${tab} posts`}
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
      </Tabs>
    </AdminLayout>
  );
}
