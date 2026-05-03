import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Activity, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BASE_PATH =
  import.meta.env.BASE_URL === "/"
    ? ""
    : import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuditLogItem {
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

async function fetchActivity(
  entity: string,
  entityId: string,
  limit = 25,
): Promise<ListResponse> {
  const params = new URLSearchParams({ entity, entityId, limit: String(limit) });
  const res = await fetch(`${BASE_PATH}/api/cms/audit-log?${params.toString()}`, {
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
  });
}

interface Props {
  entity: string;
  entityId: string | null | undefined;
  /** Render always-open without the collapse toggle. */
  alwaysOpen?: boolean;
  /** Override the visible heading. */
  title?: string;
}

// #169 — Reusable per-artifact activity tab. Drops into any edit page that
// has both an entity name (e.g. "post") and a row id. Shows the most recent
// audit-log entries for that row with diffs expandable per row.
export function ActivityTab({ entity, entityId, alwaysOpen, title }: Props) {
  const [open, setOpen] = useState(!!alwaysOpen);
  const enabled = !!entityId && (open || alwaysOpen);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cms", "audit-log", "by-entity", entity, entityId],
    queryFn: () => fetchActivity(entity, String(entityId)),
    enabled,
    staleTime: 30_000,
  });

  if (!entityId) {
    return null;
  }

  const items = data?.items ?? [];
  const heading = title ?? "Activity";

  const body = (
    <div className="px-4 py-3 space-y-2">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="text-sm text-destructive">Failed to load activity.</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No activity recorded yet.</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      <div className="pt-2">
        <a
          href={`${BASE_PATH}/admin/access/audit-log?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(String(entityId))}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          data-testid="link-activity-full-log"
        >
          See full audit log <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );

  if (alwaysOpen) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{heading}</span>
            {items.length > 0 && (
              <Badge variant="secondary" className="text-xs">{items.length}</Badge>
            )}
          </div>
        </div>
        {body}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border text-left"
        data-testid="toggle-activity-tab"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{heading}</span>
          {open && items.length > 0 && (
            <Badge variant="secondary" className="text-xs">{items.length}</Badge>
          )}
        </div>
      </button>
      {open && body}
    </Card>
  );
}

function ActivityRow({ item }: { item: AuditLogItem }) {
  const [showDiff, setShowDiff] = useState(false);
  const hasDiff =
    item.diff != null &&
    typeof item.diff === "object" &&
    Object.keys(item.diff as Record<string, unknown>).length > 0;
  const actor = item.actorDisplayName || item.actorEmail || (item.actorId ? "user" : "system");

  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm">
          <span className="font-mono text-xs">{item.action}</span>
          <span className="text-muted-foreground"> by </span>
          <span>{actor}</span>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(item.at)}
        </div>
      </div>
      {hasDiff && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showDiff ? "Hide diff" : "Show diff"}
          </button>
          {showDiff && (
            <pre className="mt-1 p-2 rounded-md bg-muted text-xs overflow-x-auto max-h-64">
              {JSON.stringify(item.diff, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

export default ActivityTab;
