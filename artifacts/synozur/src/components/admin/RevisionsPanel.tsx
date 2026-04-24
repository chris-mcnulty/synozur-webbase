import { useState } from "react";
import { ChevronDown, ChevronRight, History, RotateCcw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { api, type ServiceRevisionSummary } from "@/lib/api";

type Kind = "service" | "solution";

interface Props {
  kind: Kind;
  id: string;
  /**
   * Query keys to invalidate after a successful restore so the parent edit
   * form re-fetches the now-overwritten row.
   */
  invalidateKeys?: unknown[][];
}

// #61: collapsible history panel for services and solutions. Shared
// between `service-edit` and `solution-edit` because both drive the same
// backend pattern; differences are a handful of URLs and labels.
export function RevisionsPanel({ kind, id, invalidateKeys = [] }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const queryKey = [`${kind}-revisions`, id] as const;
  const listFn =
    kind === "service" ? api.listServiceRevisions : api.listSolutionRevisions;
  const restoreFn: (entityId: string, revisionId: string) => Promise<unknown> =
    kind === "service" ? api.restoreServiceRevision : api.restoreSolutionRevision;

  const query = useQuery({
    queryKey,
    queryFn: () => listFn(id),
    enabled: expanded && id.length > 0,
  });

  const restore = useMutation<unknown, Error, string>({
    mutationFn: (revisionId: string) => restoreFn(id, revisionId),
    onSuccess: () => {
      toast({ title: "Revision restored" });
      qc.invalidateQueries({ queryKey });
      for (const key of invalidateKeys) {
        qc.invalidateQueries({ queryKey: key as readonly unknown[] });
      }
    },
    onError: (e: Error) =>
      toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
  });

  const items: ServiceRevisionSummary[] = query.data?.items ?? [];

  return (
    <Card className="p-4 mt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left"
        data-testid={`${kind}-revisions-toggle`}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Revision history</span>
        <span className="text-xs text-muted-foreground">
          {expanded && items.length > 0 ? `${items.length} snapshot${items.length === 1 ? "" : "s"}` : ""}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No past snapshots yet — one is created automatically each time you save.
            </p>
          ) : (
            <ul
              className="space-y-2 max-h-96 overflow-y-auto"
              data-testid={`${kind}-revisions-list`}
            >
              {items.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  data-testid={`${kind}-revision-${r.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {r.snapshotTitle ?? "(untitled)"}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{new Date(r.editedAt).toLocaleString()}</span>
                      {r.editor?.displayName && (
                        <>
                          <span>·</span>
                          <span>{r.editor.displayName}</span>
                        </>
                      )}
                      {r.snapshotStatus && (
                        <>
                          <span>·</span>
                          <span className="uppercase tracking-wide">
                            {r.snapshotStatus}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (
                        confirm(
                          "Restore this revision? The current content will be snapshotted first so you can roll back.",
                        )
                      ) {
                        restore.mutate(r.id);
                      }
                    }}
                    data-testid={`${kind}-revision-restore-${r.id}`}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
