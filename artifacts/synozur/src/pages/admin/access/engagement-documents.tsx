import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// Admin surface for indexing & publishing engagement deliverables. The
// indexer walks an engagement's SPE folder; admins flip individual rows to
// `published` to expose them in the customer portal (Galaxy).

interface EngagementSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  spePath: string | null;
  organization: { id: string; name: string } | null;
}

interface AdminDoc {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  spePath: string;
  spaceItemId: string;
  lastModifiedAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  indexedAt: string;
  deletedAt: string | null;
  hideHistoryFromCustomer: boolean;
}

interface EngagementDocs {
  engagement: {
    id: string;
    title: string;
    slug: string;
    spePath: string | null;
  };
  items: AdminDoc[];
}

function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return fetch(`${base}/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  }).then(async (r) => {
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || `${r.status} ${r.statusText}`);
    }
    if (r.status === 204) return undefined as unknown as T;
    return (await r.json()) as T;
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function EngagementDocumentsPage() {
  const { toast } = useToast();
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docs, setDocs] = useState<EngagementDocs | null>(null);
  const [spePathDraft, setSpePathDraft] = useState("");
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    apiFetch<{ items: EngagementSummary[] }>("/admin/engagements")
      .then((d) => setEngagements(d.items))
      .catch((e: Error) =>
        toast({ title: "Failed to load engagements", description: e.message, variant: "destructive" }),
      );
  }, [toast]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return engagements;
    return engagements.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        (e.organization?.name.toLowerCase().includes(q) ?? false),
    );
  }, [engagements, filter]);

  const selected = engagements.find((e) => e.id === selectedId) ?? null;

  async function loadDocs(id: string) {
    setLoadingDocs(true);
    try {
      const d = await apiFetch<EngagementDocs>(`/admin/engagements/${id}/documents`);
      setDocs(d);
      setSpePathDraft(d.engagement.spePath ?? "");
    } catch (e) {
      const err = e as Error;
      toast({ title: "Failed to load documents", description: err.message, variant: "destructive" });
    } finally {
      setLoadingDocs(false);
    }
  }

  function pick(id: string) {
    setSelectedId(id);
    void loadDocs(id);
  }

  async function saveSpePath() {
    if (!selected) return;
    const next = spePathDraft.trim() === "" ? null : spePathDraft.trim();
    try {
      await apiFetch<void>(`/admin/engagements/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ spePath: next }),
      });
      setEngagements((rows) =>
        rows.map((r) => (r.id === selected.id ? { ...r, spePath: next } : r)),
      );
      toast({ title: "SharePoint path saved" });
    } catch (e) {
      const err = e as Error;
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
  }

  async function reindex() {
    if (!selected) return;
    setReindexing(true);
    try {
      const res = await apiFetch<{ added: number; updated: number; removed: number; total: number }>(
        `/admin/engagements/${selected.id}/reindex-documents`,
        { method: "POST" },
      );
      toast({
        title: "Re-indexed",
        description: `${res.added} added, ${res.updated} updated, ${res.removed} removed.`,
      });
      await loadDocs(selected.id);
    } catch (e) {
      const err = e as Error;
      toast({ title: "Re-index failed", description: err.message, variant: "destructive" });
    } finally {
      setReindexing(false);
    }
  }

  async function togglePublish(doc: AdminDoc) {
    if (!selected) return;
    const action = doc.publishedAt ? "unpublish" : "publish";
    try {
      await apiFetch<void>(`/admin/portal-documents/${doc.id}/${action}`, { method: "POST" });
      toast({ title: action === "publish" ? "Published" : "Unpublished" });
      await loadDocs(selected.id);
    } catch (e) {
      const err = e as Error;
      toast({ title: `${action} failed`, description: err.message, variant: "destructive" });
    }
  }

  async function toggleHideHistory(doc: AdminDoc) {
    if (!selected) return;
    const next = !doc.hideHistoryFromCustomer;
    try {
      await apiFetch<void>(`/admin/portal-documents/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hideHistoryFromCustomer: next }),
      });
      toast({
        title: next
          ? "Version history hidden from customer"
          : "Version history visible to customer",
      });
      await loadDocs(selected.id);
    } catch (e) {
      const err = e as Error;
      toast({
        title: "Update failed",
        description: err.message,
        variant: "destructive",
      });
    }
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Engagement Documents</h1>
          <p className="text-sm text-muted-foreground">
            Index files from each engagement's SharePoint Embedded folder, and
            choose which ones are visible in the customer portal.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <Card className="p-3 space-y-2 h-fit">
            <Input
              placeholder="Search engagements…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-engagement-filter"
            />
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  onClick={() => pick(e.id)}
                  className={`w-full text-left px-2 py-2 text-sm hover-elevate ${
                    selectedId === e.id ? "bg-muted" : ""
                  }`}
                  data-testid={`engagement-${e.slug}`}
                >
                  <div className="font-medium truncate">{e.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {e.organization?.name ?? "—"} · {e.status}
                    {e.spePath ? " · 📁" : ""}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-3">
                  No engagements.
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Pick an engagement on the left to manage its documents.
              </p>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selected.organization?.name ?? "Unassigned"} · {selected.status}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="spe-path">SharePoint folder path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="spe-path"
                      value={spePathDraft}
                      onChange={(e) => setSpePathDraft(e.target.value)}
                      placeholder="e.g. /clients/acme/2026-discovery"
                      data-testid="input-spe-path"
                    />
                    <Button onClick={saveSpePath} data-testid="button-save-spe-path">
                      Save
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={reindex}
                      disabled={reindexing || !selected.spePath}
                      data-testid="button-reindex"
                    >
                      {reindexing ? "Re-indexing…" : "Re-index"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Path inside the configured SPE container. Save first, then
                    re-index to scan its contents.
                  </p>
                </div>

                <div className="border-t border-border pt-3">
                  {loadingDocs ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : !docs || docs.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No documents indexed yet. Set a folder path and re-index.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                          <th className="py-2">File</th>
                          <th className="py-2 hidden md:table-cell">Size</th>
                          <th className="py-2 hidden md:table-cell">Modified</th>
                          <th className="py-2">Status</th>
                          <th className="py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.items.map((d) => (
                          <tr
                            key={d.id}
                            className="border-b border-border last:border-0"
                            data-testid={`admin-doc-${d.id}`}
                          >
                            <td className="py-2 pr-2">
                              <div className="font-medium truncate max-w-[32ch]">
                                {d.filename}
                              </div>
                              <div className="text-xs text-muted-foreground truncate max-w-[32ch]">
                                {d.spePath}
                              </div>
                            </td>
                            <td className="py-2 hidden md:table-cell text-muted-foreground">
                              {formatBytes(d.sizeBytes)}
                            </td>
                            <td className="py-2 hidden md:table-cell text-muted-foreground">
                              {d.lastModifiedAt
                                ? new Date(d.lastModifiedAt).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="py-2">
                              {d.deletedAt ? (
                                <Badge variant="outline">Removed</Badge>
                              ) : d.publishedAt ? (
                                <Badge>Published</Badge>
                              ) : (
                                <Badge variant="secondary">Draft</Badge>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={!!d.deletedAt || !d.publishedAt}
                                  onClick={() => toggleHideHistory(d)}
                                  data-testid={`toggle-hide-history-${d.id}`}
                                  title={
                                    d.hideHistoryFromCustomer
                                      ? "Customers cannot see prior versions. Click to reveal."
                                      : "Customers can see prior versions. Click to hide."
                                  }
                                >
                                  {d.hideHistoryFromCustomer
                                    ? "Reveal history"
                                    : "Hide history"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={d.publishedAt ? "outline" : "default"}
                                  disabled={!!d.deletedAt}
                                  onClick={() => togglePublish(d)}
                                  data-testid={`toggle-publish-${d.id}`}
                                >
                                  {d.publishedAt ? "Unpublish" : "Publish"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
