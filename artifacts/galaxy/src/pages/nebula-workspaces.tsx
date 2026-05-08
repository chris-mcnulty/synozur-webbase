import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { nebulaApi, type NebulaWorkspace } from "@/lib/nebula-api";
import { ExternalLink, Search, AlertCircle, LayoutGrid } from "lucide-react";

const STATUS_BADGE: Record<NebulaWorkspace["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  closed: "bg-muted text-muted-foreground border-border",
  archived: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function NebulaWorkspacesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<NebulaWorkspace["status"] | "all">("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["nebula-workspaces"],
    queryFn: () => nebulaApi.listWorkspaces(),
    staleTime: 60_000,
  });

  const workspaces = useMemo(() => {
    let list = data?.data ?? [];
    if (statusFilter !== "all") list = list.filter((w) => w.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (w) => w.name.toLowerCase().includes(q) || w.code.includes(q),
      );
    }
    return list;
  }, [data, search, statusFilter]);

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Nebula Workspaces</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All envisioning sessions for your organization.
            </p>
          </div>
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.data.length} workspace{data.data.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
              data-testid="input-workspace-search"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "active", "closed", "archived"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                  statusFilter === s
                    ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {(error as Error).message}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : !isError && workspaces.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <LayoutGrid size={32} className="mx-auto mb-3 opacity-30" />
              {search.trim() || statusFilter !== "all"
                ? "No workspaces match your filter."
                : "No workspaces found for your organization."}
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden" data-testid="nebula-workspaces-list">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Code</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id} className="border-t border-border hover:bg-muted/30 transition-colors" data-testid={`workspace-${w.id}`}>
                    <td className="px-4 py-3 font-medium">{w.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{w.code}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[w.status]}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmt(w.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={w.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-fuchsia-400 hover:text-fuchsia-300"
                        data-testid={`link-workspace-${w.id}`}
                      >
                        Open <ExternalLink size={11} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </PortalShell>
  );
}
