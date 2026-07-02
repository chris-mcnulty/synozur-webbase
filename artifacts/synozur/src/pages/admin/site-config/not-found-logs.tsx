import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  RefreshCcw,
  Trash2,
  Search,
  SortAsc,
  Clock,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface NotFoundLog {
  id: string;
  path: string;
  normalizedPath: string;
  hitCount: number;
  lastReferrer: string | null;
  lastUserAgent: string | null;
  resolved: boolean;
  notes: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: NotFoundLog[];
}

interface SearchResult {
  kind: string;
  title: string;
  slug: string;
  url: string;
  excerpt: string | null;
}

interface SearchResponse {
  results: SearchResult[];
}

type Filter = "false" | "true" | "all";
type Sort = "hits" | "recent";

async function listLogs(filter: Filter, sort: Sort): Promise<ListResponse> {
  return apiFetch<ListResponse>(
    `/api/cms/not-found-logs?resolved=${filter}&sort=${sort}`,
  );
}

async function patchLog(
  id: string,
  body: { resolved?: boolean; notes?: string | null },
): Promise<NotFoundLog> {
  return apiFetch<NotFoundLog>(`/api/cms/not-found-logs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function deleteLog(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/cms/not-found-logs/${id}`, { method: "DELETE" });
}

interface CreateRedirectInput {
  targetPath: string;
  statusCode?: 301 | 302;
  notes?: string | null;
}

async function createRedirectFromLog(
  id: string,
  body: CreateRedirectInput,
): Promise<{ redirect: { id: string; sourcePath: string; targetPath: string } }> {
  return apiFetch(`/api/cms/not-found-logs/${id}/redirect`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function searchContent(q: string): Promise<SearchResponse> {
  return apiFetch<SearchResponse>(
    `/api/search?q=${encodeURIComponent(q)}&limit=8`,
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const KIND_LABEL: Record<string, string> = {
  post: "Post",
  case_study: "Case study",
  white_paper: "White paper",
  service: "Service",
  solution: "Solution",
  faq: "FAQ",
  polaris_episode: "Polaris",
  application: "App",
  model: "Model",
};

function ContentSearchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(query), 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const searchQ = useQuery({
    queryKey: ["content-search", debouncedQ],
    queryFn: () => searchContent(debouncedQ),
    enabled: debouncedQ.trim().length >= 2,
    staleTime: 30_000,
  });

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const results = searchQ.data?.results ?? [];

  return (
    <div className="space-y-2">
      <Label>New target path</Label>
      <Input
        placeholder="/insights/my-post-slug"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs"
      />
      <div className="text-xs text-muted-foreground">
        Or search site content to find the right destination:
      </div>
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search posts, services, solutions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              onClick={() => { setQuery(""); setOpen(false); }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {open && debouncedQ.trim().length >= 2 && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
            {searchQ.isLoading && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
            )}
            {!searchQ.isLoading && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
            )}
            {results.map((r) => (
              <button
                key={r.url}
                type="button"
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent text-xs"
                onClick={() => {
                  onChange(r.url);
                  setQuery(r.title);
                  setOpen(false);
                }}
              >
                <span className="shrink-0 mt-0.5 rounded px-1 py-0.5 bg-muted text-muted-foreground text-[10px] font-medium leading-none">
                  {KIND_LABEL[r.kind] ?? r.kind}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{r.title}</span>
                  <span className="text-muted-foreground font-mono truncate block">{r.url}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminNotFoundLogs() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = !!access?.isEditorOrAbove;

  const [filter, setFilter] = useState<Filter>("false");
  const [sort, setSort] = useState<Sort>("recent");
  const [pathFilter, setPathFilter] = useState("");

  const queryKey = useMemo(
    () => ["/api/cms/not-found-logs", filter, sort] as const,
    [filter, sort],
  );

  const listQ = useQuery<ListResponse, Error>({
    queryKey,
    queryFn: () => listLogs(filter, sort),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/api/cms/not-found-logs"] });

  const patchMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { resolved?: boolean; notes?: string | null };
    }) => patchLog(id, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLog,
    onSuccess: () => {
      toast({ title: "Log entry deleted" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const [redirectTarget, setRedirectTarget] = useState<NotFoundLog | null>(null);
  const [redirectDraft, setRedirectDraft] = useState<CreateRedirectInput>({
    targetPath: "",
    statusCode: 301,
    notes: "",
  });

  const createRedirectMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateRedirectInput }) =>
      createRedirectFromLog(id, body),
    onSuccess: (resp) => {
      toast({
        title: "Redirect created",
        description: `${resp.redirect.sourcePath} → ${resp.redirect.targetPath}`,
      });
      setRedirectTarget(null);
      setRedirectDraft({ targetPath: "", statusCode: 301, notes: "" });
      invalidate();
      qc.invalidateQueries({ queryKey: ["/api/cms/wix-redirects"] });
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const onOpenRedirect = (row: NotFoundLog) => {
    setRedirectTarget(row);
    setRedirectDraft({ targetPath: "", statusCode: 301, notes: "" });
  };

  const onSubmitRedirect = () => {
    if (!redirectTarget) return;
    const target = redirectDraft.targetPath.trim();
    if (!target.startsWith("/")) {
      toast({ title: "Target must start with /", variant: "destructive" });
      return;
    }
    createRedirectMut.mutate({
      id: redirectTarget.id,
      body: {
        targetPath: target,
        statusCode: redirectDraft.statusCode ?? 301,
        notes: redirectDraft.notes?.trim() || null,
      },
    });
  };

  const allItems = listQ.data?.items ?? [];

  const items = useMemo(() => {
    const q = pathFilter.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((r) => r.path.toLowerCase().includes(q));
  }, [allItems, pathFilter]);

  return (
    <AdminLayout
      title="404 log"
      crumbs={[{ label: "Admin", href: "/" }, { label: "404 log" }]}
    >
      <div className="space-y-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Every distinct path that hit the 404 page is logged here. Create a
            redirect from any row to fix the broken URL and mark it resolved in
            one step.
          </p>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Resolved filter */}
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            data-testid="filter-not-found-status"
          >
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="all">All</option>
          </select>

          {/* Sort toggle */}
          <div className="flex rounded-md border border-input overflow-hidden text-sm h-9">
            <button
              type="button"
              className={`flex items-center gap-1.5 px-3 h-full transition-colors ${
                sort === "recent"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent"
              }`}
              onClick={() => setSort("recent")}
              title="Sort by most recently seen"
            >
              <Clock className="h-3.5 w-3.5" />
              Recent
            </button>
            <button
              type="button"
              className={`flex items-center gap-1.5 px-3 h-full border-l border-input transition-colors ${
                sort === "hits"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent"
              }`}
              onClick={() => setSort("hits")}
              title="Sort by most hits"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Most hits
            </button>
          </div>

          {/* Path search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Filter by path…"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
            {pathFilter && (
              <button
                type="button"
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setPathFilter("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => listQ.refetch()}
            disabled={listQ.isFetching}
          >
            <RefreshCcw className="h-4 w-4 mr-1" />
            Refresh
          </Button>

          {/* Row count */}
          {!listQ.isLoading && (
            <span className="text-xs text-muted-foreground ml-auto">
              {items.length}{allItems.length !== items.length ? ` of ${allItems.length}` : ""} rows
            </span>
          )}
        </div>

        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead className="w-[70px]">
                  <button
                    type="button"
                    className="flex items-center gap-0.5 hover:text-foreground"
                    onClick={() => setSort(sort === "hits" ? "recent" : "hits")}
                    title="Toggle sort"
                  >
                    Hits <SortAsc className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="w-[160px]">
                  <button
                    type="button"
                    className="flex items-center gap-0.5 hover:text-foreground"
                    onClick={() => setSort(sort === "recent" ? "hits" : "recent")}
                    title="Toggle sort"
                  >
                    Last seen <SortAsc className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>Referrer</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[170px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : listQ.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-destructive">
                    Failed to load: {listQ.error?.message}
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {pathFilter
                      ? `No 404s matching "${pathFilter}".`
                      : "No 404s logged for the selected filter."}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs break-all max-w-[280px]">
                      {r.path}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{r.hitCount}</TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={formatDate(r.lastSeenAt)}
                    >
                      {formatDateShort(r.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground break-all max-w-[200px] truncate">
                      {r.lastReferrer ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.resolved ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Resolved
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Open</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {canWrite && !r.resolved && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenRedirect(r)}
                          data-testid={`btn-create-redirect-${r.id}`}
                        >
                          <ArrowRight className="h-4 w-4 mr-1" />
                          Redirect
                        </Button>
                      )}
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={r.resolved ? "Mark unresolved" : "Mark resolved"}
                            aria-label={
                              r.resolved
                                ? `Mark ${r.path} unresolved`
                                : `Mark ${r.path} resolved`
                            }
                            onClick={() =>
                              patchMut.mutate({
                                id: r.id,
                                body: { resolved: !r.resolved },
                              })
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Delete log entry"
                            aria-label={`Delete log entry for ${r.path}`}
                            onClick={() => {
                              if (!confirm(`Delete log entry for ${r.path}? This cannot be undone.`)) return;
                              deleteMut.mutate(r.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Redirect dialog */}
      <Dialog
        open={!!redirectTarget}
        onOpenChange={(open) => {
          if (!open) setRedirectTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create redirect from 404</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Source path (from log)</Label>
              <Input
                value={redirectTarget?.path ?? ""}
                disabled
                className="font-mono text-xs"
              />
            </div>

            <ContentSearchPicker
              value={redirectDraft.targetPath}
              onChange={(path) => setRedirectDraft((d) => ({ ...d, targetPath: path }))}
            />

            <div>
              <Label htmlFor="nf-status">Status</Label>
              <select
                id="nf-status"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={redirectDraft.statusCode ?? 301}
                onChange={(e) =>
                  setRedirectDraft((d) => ({
                    ...d,
                    statusCode: Number(e.target.value) === 302 ? 302 : 301,
                  }))
                }
              >
                <option value={301}>301 Permanent</option>
                <option value={302}>302 Temporary</option>
              </select>
            </div>
            <div>
              <Label htmlFor="nf-notes">Notes (optional)</Label>
              <Input
                id="nf-notes"
                placeholder="e.g. Old Wix slug from the launch announcement"
                value={redirectDraft.notes ?? ""}
                onChange={(e) =>
                  setRedirectDraft((d) => ({ ...d, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedirectTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={onSubmitRedirect}
              disabled={createRedirectMut.isPending || !redirectDraft.targetPath.trim()}
            >
              {createRedirectMut.isPending ? "Creating…" : "Create redirect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
