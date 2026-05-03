import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, Download, Filter, RefreshCw } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const BASE_PATH =
  import.meta.env.BASE_URL === "/"
    ? ""
    : import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  diff: unknown;
  at: string;
}

interface ListResponse {
  items: AuditLogItem[];
  nextCursor: string | null;
}

interface Filters {
  actorEmail: string;
  entity: string;
  entityId: string;
  actionPrefix: string;
  from: string;
  to: string;
}

function emptyFilters(): Filters {
  return { actorEmail: "", entity: "", entityId: "", actionPrefix: "", from: "", to: "" };
}

function readUrlFilters(): Filters {
  if (typeof window === "undefined") return emptyFilters();
  const sp = new URLSearchParams(window.location.search);
  return {
    actorEmail: sp.get("actorEmail") ?? "",
    entity: sp.get("entity") ?? "",
    entityId: sp.get("entityId") ?? "",
    actionPrefix: sp.get("actionPrefix") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
  };
}

function buildQs(f: Filters, cursor?: string | null, limit = 50): string {
  const sp = new URLSearchParams();
  if (f.actorEmail.trim()) sp.set("actorEmail", f.actorEmail.trim());
  if (f.entity.trim()) sp.set("entity", f.entity.trim());
  if (f.entityId.trim()) sp.set("entityId", f.entityId.trim());
  if (f.actionPrefix.trim()) sp.set("actionPrefix", f.actionPrefix.trim());
  if (f.from) sp.set("from", new Date(f.from).toISOString());
  if (f.to) sp.set("to", new Date(f.to).toISOString());
  sp.set("limit", String(limit));
  if (cursor) sp.set("cursor", cursor);
  return sp.toString();
}

async function fetchPage(f: Filters, cursor: string | null): Promise<ListResponse> {
  const res = await fetch(`${BASE_PATH}/api/cms/audit-log?${buildQs(f, cursor)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<ListResponse>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditLogPage() {
  const [draft, setDraft] = useState<Filters>(() => readUrlFilters());
  const [applied, setApplied] = useState<Filters>(() => readUrlFilters());
  const [drawerItem, setDrawerItem] = useState<AuditLogItem | null>(null);

  // Keep the URL in sync with the applied filters so links/back-button work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = buildQs(applied);
    const url = new URL(window.location.href);
    // Strip the limit/cursor we don't want to display.
    const sp = new URLSearchParams(qs);
    sp.delete("limit");
    sp.delete("cursor");
    url.search = sp.toString();
    window.history.replaceState(null, "", url.toString());
  }, [applied]);

  const query = useInfiniteQuery<ListResponse, Error>({
    queryKey: ["cms", "audit-log", "list", applied],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchPage(applied, (pageParam as string | null) ?? null),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });

  const items: AuditLogItem[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  // Infinite-scroll sentinel.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [query]);

  function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    setApplied(draft);
  }

  function resetFilters() {
    const empty = emptyFilters();
    setDraft(empty);
    setApplied(empty);
  }

  function downloadCsv() {
    const url = `${BASE_PATH}/api/cms/audit-log.csv?${buildQs(applied)}`;
    window.open(url, "_blank");
  }

  return (
    <AdminLayout
      title="Audit Log"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Access" }, { label: "Audit Log" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            data-testid="button-audit-log-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            data-testid="button-audit-log-csv"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Card className="p-4">
          <form
            onSubmit={applyFilters}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3"
          >
            <div>
              <Label htmlFor="al-actor">Actor email</Label>
              <Input
                id="al-actor"
                value={draft.actorEmail}
                onChange={(e) => setDraft({ ...draft, actorEmail: e.target.value })}
                placeholder="user@example.com"
                data-testid="input-audit-log-actor"
              />
            </div>
            <div>
              <Label htmlFor="al-entity">Entity</Label>
              <Input
                id="al-entity"
                value={draft.entity}
                onChange={(e) => setDraft({ ...draft, entity: e.target.value })}
                placeholder="post"
                data-testid="input-audit-log-entity"
              />
            </div>
            <div>
              <Label htmlFor="al-entity-id">Entity ID</Label>
              <Input
                id="al-entity-id"
                value={draft.entityId}
                onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
                data-testid="input-audit-log-entity-id"
              />
            </div>
            <div>
              <Label htmlFor="al-action">Action prefix</Label>
              <Input
                id="al-action"
                value={draft.actionPrefix}
                onChange={(e) => setDraft({ ...draft, actionPrefix: e.target.value })}
                placeholder="post.publish"
                data-testid="input-audit-log-action"
              />
            </div>
            <div>
              <Label htmlFor="al-from">From</Label>
              <Input
                id="al-from"
                type="datetime-local"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                data-testid="input-audit-log-from"
              />
            </div>
            <div>
              <Label htmlFor="al-to">To</Label>
              <Input
                id="al-to"
                type="datetime-local"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                data-testid="input-audit-log-to"
              />
            </div>
            <div className="flex items-end gap-2 xl:col-span-6">
              <Button type="submit" size="sm" data-testid="button-audit-log-apply">
                <Filter className="h-4 w-4 mr-2" />
                Apply
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetFilters}
                data-testid="button-audit-log-reset"
              >
                Reset
              </Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Audit Stream</span>
              {items.length > 0 && (
                <Badge variant="secondary" className="text-xs">{items.length}</Badge>
              )}
            </div>
          </div>

          {query.isLoading ? (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : query.error ? (
            <div className="px-4 py-10 text-center text-destructive text-sm">
              Failed to load audit log.
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              No entries match the current filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Entity ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setDrawerItem(row)}
                    data-testid={`row-audit-${row.id}`}
                  >
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDate(row.at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.actorDisplayName || row.actorEmail || (
                        <span className="text-muted-foreground">system</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.action}</TableCell>
                    <TableCell className="text-sm">{row.entity}</TableCell>
                    <TableCell className="font-mono text-xs">{row.entityId ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div ref={sentinelRef} className="h-6" aria-hidden />
          {query.isFetchingNextPage && (
            <div className="px-4 py-3 text-center text-xs text-muted-foreground">
              Loading more…
            </div>
          )}
        </Card>
      </div>

      <Sheet open={!!drawerItem} onOpenChange={(o) => !o && setDrawerItem(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit Entry</SheetTitle>
          </SheetHeader>
          {drawerItem && <AuditDetail item={drawerItem} />}
        </SheetContent>
      </Sheet>
    </AdminLayout>
  );
}

function AuditDetail({ item }: { item: AuditLogItem }) {
  const diff = item.diff as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  const before = diff?.before ?? null;
  const after = diff?.after ?? null;
  const keys = Array.from(
    new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]),
  );

  return (
    <div className="mt-4 space-y-4">
      <dl className="grid grid-cols-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">When</dt>
        <dd className="col-span-2">{formatDate(item.at)}</dd>
        <dt className="text-muted-foreground">Actor</dt>
        <dd className="col-span-2">
          {item.actorDisplayName || item.actorEmail || (
            <span className="text-muted-foreground">system</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Action</dt>
        <dd className="col-span-2 font-mono text-xs">{item.action}</dd>
        <dt className="text-muted-foreground">Entity</dt>
        <dd className="col-span-2">
          {item.entity}
          {item.entityId ? (
            <span className="ml-1 font-mono text-xs text-muted-foreground">({item.entityId})</span>
          ) : null}
        </dd>
      </dl>

      {keys.length === 0 ? (
        <div className="text-sm text-muted-foreground">No diff captured for this entry.</div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-medium">Field changes</div>
          <div className="rounded-md border border-border divide-y divide-border">
            {keys.map((k) => (
              <div key={k} className="grid grid-cols-3 gap-2 p-2 text-xs">
                <div className="font-mono">{k}</div>
                <div>
                  <div className="text-muted-foreground mb-0.5">before</div>
                  <pre className="whitespace-pre-wrap break-all bg-muted/40 p-1 rounded">
                    {before && k in before ? JSON.stringify(before[k], null, 2) : "—"}
                  </pre>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5">after</div>
                  <pre className="whitespace-pre-wrap break-all bg-muted/40 p-1 rounded">
                    {after && k in after ? JSON.stringify(after[k], null, 2) : "—"}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
