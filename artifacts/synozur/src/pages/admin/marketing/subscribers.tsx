import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

interface SubscriberRow {
  id: number;
  email: string;
  status: "pending" | "confirmed" | "unsubscribed" | string;
  source: string | null;
  confirmationSentAt: string | null;
  confirmedAt: string | null;
  confirmedIp: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  funnel: { pending: number; confirmed: number; unsubscribed: number };
  items: SubscriberRow[];
}

type Tab = "all" | "pending" | "confirmed" | "unsubscribed";

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
      } catch {
        /* ignore */
      }
      throw new Error(`${r.status} ${detail}`);
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  });
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "confirmed") return <Badge>confirmed</Badge>;
  if (status === "pending") return <Badge variant="secondary">pending</Badge>;
  if (status === "unsubscribed") return <Badge variant="destructive">unsubscribed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function SubscribersAdminPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab !== "all") params.set("status", tab);
      if (search.trim()) params.set("search", search.trim());
      const qs = params.toString();
      const res = await apiFetch<ListResponse>(
        `/admin/marketing/subscribers${qs ? `?${qs}` : ""}`,
      );
      setData(res);
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

  useEffect(() => {
    void refresh();
     
  }, [tab]);

  async function resend(id: number) {
    setBusyId(id);
    try {
      const r = await apiFetch<{ ok: boolean; emailStatus: string; error: string | null }>(
        `/admin/marketing/subscribers/${id}/resend`,
        { method: "POST" },
      );
      if (r.ok) {
        toast({ title: "Confirmation email re-sent", description: `Status: ${r.emailStatus}` });
      } else {
        toast({
          title: "Email send failed",
          description: r.error ?? r.emailStatus,
          variant: "destructive",
        });
      }
      await refresh();
    } catch (e) {
      toast({
        title: "Resend failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  const funnel = data?.funnel ?? { pending: 0, confirmed: 0, unsubscribed: 0 };
  const total = funnel.pending + funnel.confirmed + funnel.unsubscribed;
  const confirmRate = useMemo(() => {
    const denom = funnel.pending + funnel.confirmed;
    return denom > 0 ? Math.round((funnel.confirmed / denom) * 100) : 0;
  }, [funnel.pending, funnel.confirmed]);

  return (
    <AdminLayout
      title="Newsletter subscribers"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "Subscribers" }]}
    >
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6" data-testid="subscribers-funnel">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Pending</div>
          <div className="text-2xl font-semibold mt-1" data-testid="funnel-pending">
            {funnel.pending}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Confirmed</div>
          <div className="text-2xl font-semibold mt-1" data-testid="funnel-confirmed">
            {funnel.confirmed}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Unsubscribed
          </div>
          <div className="text-2xl font-semibold mt-1" data-testid="funnel-unsubscribed">
            {funnel.unsubscribed}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Confirm rate
          </div>
          <div className="text-2xl font-semibold mt-1" data-testid="funnel-confirm-rate">
            {confirmRate}%
          </div>
          <div className="text-xs text-muted-foreground">{total} total</div>
        </Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "pending", "confirmed", "unsubscribed"] as Tab[]).map((t) => (
            <Button
              key={t}
              variant={tab === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t)}
              data-testid={`tab-${t}`}
            >
              {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
          <div className="flex-1" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Search by email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
              data-testid="subscribers-search"
            />
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          </form>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading || !data ? (
          <div className="p-6 text-muted-foreground">Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="p-6 text-muted-foreground">No subscribers match.</div>
        ) : (
          <table className="w-full text-sm" data-testid="subscribers-table">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-left px-4 py-2">Confirmation sent</th>
                <th className="text-left px-4 py-2">Confirmed</th>
                <th className="text-left px-4 py-2">Created</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr
                  key={row.id}
                  className="border-t"
                  data-testid={`subscriber-row-${row.id}`}
                >
                  <td className="px-4 py-2 font-mono text-xs">{row.email}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{row.source ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDate(row.confirmationSentAt)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDate(row.confirmedAt)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    {row.status !== "pending" ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => void resend(row.id)}
                        data-testid={`resend-${row.id}`}
                      >
                        {busyId === row.id ? "Sending…" : "Resend confirmation"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AdminLayout>
  );
}
