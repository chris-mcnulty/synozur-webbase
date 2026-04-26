import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface LockoutEvent {
  id: string;
  ip: string;
  at: string;
}

async function fetchLockouts(): Promise<LockoutEvent[]> {
  const res = await fetch(`${BASE_PATH}/api/cms/security/lockouts`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<LockoutEvent[]>;
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

const RECENT_THRESHOLD_MS = 60 * 60 * 1000;

export default function SecurityLogPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<LockoutEvent[]>({
    queryKey: ["cms", "security", "lockouts"],
    queryFn: fetchLockouts,
    staleTime: 30_000,
  });

  const events = data ?? [];
  const now = Date.now();
  const recentCount = events.filter(
    (e) => now - new Date(e.at).getTime() < RECENT_THRESHOLD_MS,
  ).length;

  return (
    <AdminLayout
      title="Security Log"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Access" }, { label: "Security Log" }]}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {recentCount > 0 && (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <span>
              <strong>{recentCount}</strong> IP{recentCount !== 1 ? "s have" : " has"} been
              temporarily blocked in the last hour due to too many failed sign-in attempts.
            </span>
          </div>
        )}

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Rate-Limited Login Attempts</span>
              {events.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {events.length}
                </Badge>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center text-destructive text-sm">
              Failed to load security log.
            </div>
          ) : events.length === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              No rate-limited attempts recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Blocked At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => {
                  const isRecent = now - new Date(e.at).getTime() < RECENT_THRESHOLD_MS;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-sm">{e.ip}</TableCell>
                      <TableCell className="text-sm">
                        <span>{formatDate(e.at)}</span>
                        {isRecent && (
                          <Badge
                            variant="destructive"
                            className="ml-2 text-xs py-0 px-1.5"
                          >
                            recent
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
