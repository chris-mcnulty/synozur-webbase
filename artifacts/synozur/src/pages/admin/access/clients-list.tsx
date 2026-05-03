import { useEffect, useState } from "react";
import { AppLink } from "@/components/ui/app-link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// #225 — Account-manager-facing list of client organizations. The existing
// `/access/organizations` page is Entra-tenant focused; this one surfaces the
// fields account managers care about (primary contact, account manager,
// member count) and links into a per-org edit page.

interface ClientOrgRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  defaultRoleName: string | null;
  accountManagerUserId: string | null;
  accountManagerName: string | null;
  accountManagerEmail: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  userCount: number;
  createdAt: string;
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
      let detail = r.statusText;
      try {
        const j = (await r.json()) as { error?: string };
        if (j.error) detail = j.error;
      } catch { /* ignore */ }
      throw new Error(`${r.status} ${detail}`);
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  });
}

const PAGE_SIZE = 25;

export default function ClientsListPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ClientOrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: ClientOrgRow[] }>("/admin/client-orgs");
      setRows(data.items);
    } catch (e) {
      toast({
        title: "Load failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  const filtered = rows.filter((r) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.slug.toLowerCase().includes(q) ||
      (r.accountManagerName ?? "").toLowerCase().includes(q) ||
      (r.accountManagerEmail ?? "").toLowerCase().includes(q) ||
      (r.primaryContactEmail ?? "").toLowerCase().includes(q)
    );
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { setPage(0); }, [filter]);

  return (
    <AdminLayout
      title="Client organizations"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Access" }, { label: "Client orgs" }]}
      actions={
        <Button asChild data-testid="button-new-client-org">
          <AppLink href="/access/clients/new" unstyled>New client organization</AppLink>
        </Button>
      }
    >
      <Card className="p-4 mb-4 flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Filter by name, slug, account manager, or contact…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
          data-testid="input-client-org-filter"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
      </Card>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          {rows.length === 0
            ? "No client organizations yet. Create your first one to start onboarding clients."
            : "No organizations match that filter."}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Organization</th>
                <th className="text-left px-4 py-2">Primary contact</th>
                <th className="text-left px-4 py-2">Account manager</th>
                <th className="text-left px-4 py-2">Default role</th>
                <th className="text-right px-4 py-2">Users</th>
                <th className="text-left px-4 py-2">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-muted/20"
                  data-testid={`row-client-org-${r.slug}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.primaryContactEmail ? (
                      <>
                        <div>{r.primaryContactName ?? r.primaryContactEmail}</div>
                        {r.primaryContactName && (
                          <div className="text-xs text-muted-foreground">{r.primaryContactEmail}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.accountManagerEmail ? (
                      <>
                        <div>{r.accountManagerName ?? r.accountManagerEmail}</div>
                        {r.accountManagerName && (
                          <div className="text-xs text-muted-foreground">{r.accountManagerEmail}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.defaultRoleName
                      ? <Badge variant="outline">{r.defaultRoleName}</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.userCount}</td>
                  <td className="px-4 py-3">
                    {r.isActive
                      ? <Badge>Active</Badge>
                      : <Badge variant="secondary">Inactive</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      data-testid={`button-edit-${r.slug}`}
                    >
                      <AppLink href={`/access/clients/${r.id}`} unstyled>Manage</AppLink>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3 mt-3 text-sm">
          <span className="text-muted-foreground">
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            data-testid="button-clients-prev"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            data-testid="button-clients-next"
          >
            Next
          </Button>
        </div>
      )}
    </AdminLayout>
  );
}
