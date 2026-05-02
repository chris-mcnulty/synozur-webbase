import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  RefreshCcw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// #155 — CSP violations dashboard. Shows browser-reported policy violations
// while the CSP is rolled out in Report-Only mode. Once the violation stream
// is empty for two consecutive days, set CSP_ENFORCE=1 to flip to enforcing.

interface CspViolation {
  id: string;
  documentPath: string;
  violatedDirective: string;
  effectiveDirective: string | null;
  blockedUri: string;
  disposition: string | null;
  statusCode: number | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface ListResponse {
  total: number;
  items: CspViolation[];
}

const PAGE_SIZE = 50;

function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return fetch(`${base}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...init.headers },
    ...init,
  }).then(async (r) => {
    if (r.status === 204) return undefined as T;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}${text ? `: ${text}` : ""}`);
    }
    return r.json() as Promise<T>;
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function directiveBadgeColor(directive: string): string {
  if (directive.startsWith("script")) return "bg-red-500/10 text-red-400 border-red-500/20";
  if (directive.startsWith("style")) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  if (directive.startsWith("connect")) return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (directive.startsWith("img")) return "bg-green-500/10 text-green-400 border-green-500/20";
  if (directive.startsWith("frame")) return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
}

export default function CspViolationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [directive, setDirective] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearAll, setClearAll] = useState(false);

  const offset = page * PAGE_SIZE;
  const filterParam = directive !== "all" ? `&directive=${encodeURIComponent(directive)}` : "";

  const { data, isLoading, isFetching } = useQuery<ListResponse>({
    queryKey: ["csp-violations", page, directive],
    queryFn: () =>
      apiFetch<ListResponse>(
        `/api/cms/csp/violations?limit=${PAGE_SIZE}&offset=${offset}${filterParam}`,
      ),
  });

  const { data: directives } = useQuery<string[]>({
    queryKey: ["csp-directives"],
    queryFn: () => apiFetch<string[]>("/api/cms/csp/directives"),
  });

  const deleteOne = useMutation({
    mutationFn: (id: string) =>
      apiFetch<undefined>(`/api/cms/csp/violations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["csp-violations"] });
      toast({ title: "Violation removed" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const deleteAll = useMutation({
    mutationFn: () =>
      apiFetch<undefined>("/api/cms/csp/violations", { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["csp-violations"] });
      void qc.invalidateQueries({ queryKey: ["csp-directives"] });
      setPage(0);
      toast({ title: "All violations cleared" });
    },
    onError: () => toast({ title: "Clear failed", variant: "destructive" }),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const isEmpty = !isLoading && data?.total === 0;

  return (
    <AdminLayout
      title="CSP Violations"
      crumbs={[
        { label: "Site Config" },
        { label: "CSP Violations" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: ["csp-violations"] });
              void qc.invalidateQueries({ queryKey: ["csp-directives"] });
            }}
            disabled={isFetching}
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {data && data.total > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              onClick={() => setClearAll(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <Card className="p-4 bg-amber-500/5 border-amber-500/20">
          <div className="flex gap-3">
            <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-zinc-300">
              <span className="font-medium text-amber-300">Report-Only mode</span> — browsers are
              reporting violations but resources are not blocked. Monitor this table for ≥ 7 days of
              clean production traffic, then set{" "}
              <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">CSP_ENFORCE=1</code> to
              flip the header to enforcing.
            </div>
          </div>
        </Card>

        {directives && directives.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-400 whitespace-nowrap">Filter by directive</label>
            <Select value={directive} onValueChange={(v) => { setDirective(v); setPage(0); }}>
              <SelectTrigger className="w-52 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All directives</SelectItem>
                {directives.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data && (
              <span className="text-sm text-zinc-500">
                {data.total} violation{data.total !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {isEmpty ? (
          <Card className="p-12 flex flex-col items-center gap-3 text-center">
            <ShieldAlert className="w-10 h-10 text-green-400 opacity-60" />
            <p className="text-zinc-300 font-medium">No violations recorded</p>
            <p className="text-sm text-zinc-500 max-w-sm">
              Browsers haven't reported any CSP violations yet. This table will fill up once
              real traffic hits the page with the Report-Only header active.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="text-zinc-400">Directive</TableHead>
                  <TableHead className="text-zinc-400">Blocked URI</TableHead>
                  <TableHead className="text-zinc-400">Document path</TableHead>
                  <TableHead className="text-zinc-400 text-right">Hits</TableHead>
                  <TableHead className="text-zinc-400">Last seen</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-zinc-800">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-zinc-800 rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {data?.items.map((v) => (
                  <TableRow key={v.id} className="border-zinc-800 hover:bg-zinc-800/30">
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs font-mono ${directiveBadgeColor(v.violatedDirective)}`}
                      >
                        {v.violatedDirective}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="max-w-xs truncate text-sm text-zinc-300 font-mono"
                      title={v.blockedUri}
                    >
                      {v.blockedUri}
                    </TableCell>
                    <TableCell
                      className="max-w-xs truncate text-sm text-zinc-400"
                      title={v.documentPath}
                    >
                      {v.documentPath}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`text-sm font-medium tabular-nums ${
                          v.occurrences >= 100
                            ? "text-red-400"
                            : v.occurrences >= 10
                              ? "text-amber-400"
                              : "text-zinc-300"
                        }`}
                      >
                        {v.occurrences.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-500 whitespace-nowrap">
                      {timeAgo(v.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-zinc-600 hover:text-red-400"
                        onClick={() => setDeleteId(v.id)}
                        title="Remove this violation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                <span className="text-sm text-zinc-500">
                  Page {page + 1} of {totalPages} · {data?.total ?? 0} total
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove violation?</AlertDialogTitle>
            <AlertDialogDescription>
              This row will be permanently removed. If browsers report the same violation again a
              new row will be created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deleteId) deleteOne.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAll} onOpenChange={setClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Clear all violations?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {data?.total} violation rows. Use this after
              confirming a zero-violation baseline before flipping to enforcing mode.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                deleteAll.mutate();
                setClearAll(false);
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
