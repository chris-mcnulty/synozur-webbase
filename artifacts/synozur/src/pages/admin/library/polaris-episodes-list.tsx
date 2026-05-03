import { useMemo, useState, type ReactNode } from "react";
import { AppLink } from "@/components/ui/app-link";
import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { PolarisLibsynImportDialog } from "@/components/admin/PolarisLibsynImportDialog";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  type PolarisEpisodeDto,
  type PolarisCollateralLinkDto,
} from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

type SyncStatus =
  | "missing"
  | "missing-tags"
  | "stale"
  | "ok"
  | "loading"
  | "error";

interface SyncEvaluation {
  status: Exclude<SyncStatus, "loading" | "error">;
  reasons: string[];
}

function syncStatusFor(
  episode: PolarisEpisodeDto,
  collateral: PolarisCollateralLinkDto | null,
): SyncEvaluation {
  if (!collateral) {
    return {
      status: "missing",
      reasons: ["No collateral record exists in the library."],
    };
  }
  // Episode itself is missing tags → re-syncing won't help; the editor needs
  // to set them on the episode first.
  const episodeMissing: string[] = [];
  if (!episode.serviceId) episodeMissing.push("service");
  if (!episode.solutionId) episodeMissing.push("solution");
  if (episodeMissing.length > 0) {
    return {
      status: "missing-tags",
      reasons: [
        `Episode is missing ${episodeMissing.join(" and ")} tag${
          episodeMissing.length > 1 ? "s" : ""
        }. Edit the episode to set them.`,
      ],
    };
  }
  // Episode has both tags → check whether the collateral row matches.
  const reasons: string[] = [];
  if (collateral.serviceId !== episode.serviceId) {
    reasons.push(
      collateral.serviceId
        ? "Collateral's service tag does not match the episode."
        : "Collateral is missing the service tag.",
    );
  }
  if (collateral.solutionId !== episode.solutionId) {
    reasons.push(
      collateral.solutionId
        ? "Collateral's solution tag does not match the episode."
        : "Collateral is missing the solution tag.",
    );
  }
  return { status: reasons.length > 0 ? "stale" : "ok", reasons };
}

function SyncStatusBadge({
  status,
  onClick,
  disabled,
  syncing,
  testId,
  reason,
}: {
  status: SyncStatus;
  onClick?: () => void;
  disabled?: boolean;
  syncing?: boolean;
  testId: string;
  reason?: string;
}) {
  const config: Record<
    SyncStatus,
    { icon: ReactNode; label: string; className: string; tooltip: string }
  > = {
    loading: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: "Checking…",
      className: "text-muted-foreground",
      tooltip: "Checking library sync status…",
    },
    error: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: "Unknown",
      className: "text-muted-foreground",
      tooltip: "Could not load sync status.",
    },
    missing: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      label: "Missing",
      className: "text-destructive",
      tooltip:
        reason ??
        "No collateral record exists in the library. Click to create one.",
    },
    "missing-tags": {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: "Missing tags",
      className: "text-amber-600 dark:text-amber-500",
      tooltip:
        reason ??
        "Episode is missing service or solution tags. Edit the episode to set them — re-syncing alone won't fix it.",
    },
    stale: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: "Stale tags",
      className: "text-amber-600 dark:text-amber-500",
      tooltip:
        reason ??
        "Collateral exists but its service/solution tags do not match the episode. Click to re-sync.",
    },
    ok: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: "Synced",
      className: "text-emerald-600 dark:text-emerald-500",
      tooltip:
        "Collateral record is in sync. Click to force a re-sync if fields have changed.",
    },
  };

  const c = config[status];
  const clickable = !!onClick && !disabled && status !== "loading";

  const inner = (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable || syncing}
      data-testid={testId}
      className={`inline-flex items-center gap-1 text-xs font-medium ${c.className} ${
        clickable ? "hover:underline cursor-pointer" : "cursor-default"
      } disabled:opacity-60`}
    >
      {syncing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        c.icon
      )}
      <span>{syncing ? "Syncing…" : c.label}</span>
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent>{c.tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function AdminPolarisEpisodesList() {
  const qc = useQueryClient();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;
  const [importOpen, setImportOpen] = useState(false);

  const listQ = useQuery({
    queryKey: ["admin-polaris-episodes"],
    queryFn: () => api.adminListPolarisEpisodes(),
  });
  const items: PolarisEpisodeDto[] = listQ.data?.items ?? [];

  const servicesQ = useQuery({
    queryKey: ["admin-services"],
    queryFn: () => api.listServicesAdmin(),
  });
  const services = servicesQ.data?.items ?? [];

  const serviceById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.title);
    return m;
  }, [services]);
  const solutionById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) {
      for (const sol of s.solutions) m.set(sol.id, sol.title);
    }
    return m;
  }, [services]);

  // Per-row library sync status. We fetch the linked collateral record for
  // each episode in parallel so editors can spot missing or stale records at
  // a glance. Enabled only after the list query has loaded.
  const collateralQs = useQueries({
    queries: items.map((e) => ({
      queryKey: ["admin-polaris-episode-collateral", e.id],
      queryFn: () => api.getPolarisCollateralLink(e.id),
      enabled: !!e.id,
      staleTime: 30_000,
    })),
  });
  const collateralByEpisodeId = useMemo(() => {
    const m = new Map<
      string,
      {
        status: SyncStatus;
        reasons: string[];
        collateral: PolarisCollateralLinkDto | null;
      }
    >();
    items.forEach((e, i) => {
      const q = collateralQs[i];
      if (!q) return;
      if (q.isLoading) {
        m.set(e.id, { status: "loading", reasons: [], collateral: null });
      } else if (q.isError) {
        m.set(e.id, { status: "error", reasons: [], collateral: null });
      } else {
        const collateral = q.data?.collateral ?? null;
        const evalResult = syncStatusFor(e, collateral);
        m.set(e.id, {
          status: evalResult.status,
          reasons: evalResult.reasons,
          collateral,
        });
      }
    });
    return m;
  }, [items, collateralQs]);

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updatePolarisEpisode>[1] }) =>
      api.updatePolarisEpisode(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] }),
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deletePolarisEpisode(id),
    onSuccess: () => {
      toast({ title: "Episode archived" });
      qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const bulkSyncMut = useMutation({
    mutationFn: () => api.bulkSyncPolarisToCollateral(),
    onSuccess: (data) => {
      toast({
        title: "Bulk re-sync complete",
        description: `${data.updated} updated, ${data.created} created (${data.total} episodes total).`,
      });
      qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] });
      qc.invalidateQueries({
        queryKey: ["admin-polaris-episode-collateral"],
      });
    },
    onError: (e: Error) =>
      toast({ title: "Bulk re-sync failed", description: e.message, variant: "destructive" }),
  });

  const singleSyncMut = useMutation({
    mutationFn: (id: string) => api.syncPolarisToCollateral(id),
    onSuccess: (_data, id) => {
      toast({ title: "Library entry synced" });
      qc.invalidateQueries({
        queryKey: ["admin-polaris-episode-collateral", id],
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Sync failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const onToggleActive = (e: PolarisEpisodeDto, active: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({
      id: e.id,
      data: { title: e.title, episodeNumber: e.episodeNumber, active },
    });
  };

  const onDelete = (e: PolarisEpisodeDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive "${e.title}"? This will remove it from the public site.`)) return;
    deleteMut.mutate(e.id);
  };

  const onSyncOne = (e: PolarisEpisodeDto) => {
    if (!canWrite) return;
    singleSyncMut.mutate(e.id);
  };

  return (
    <TooltipProvider delayDuration={200}>
    <AdminLayout
      title="Polaris Episodes"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Polaris" }]}
      actions={
        canWrite && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              data-testid="button-open-libsyn-import"
            >
              <Download className="h-4 w-4 mr-2" /> Import from Libsyn
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!confirm("Re-sync all Polaris episodes to the library? This will update service and solution tags on every episode's collateral record.")) return;
                bulkSyncMut.mutate();
              }}
              disabled={bulkSyncMut.isPending}
              data-testid="button-bulk-sync-polaris"
            >
              <RefreshCw className={`h-4 w-4 mr-2${bulkSyncMut.isPending ? " animate-spin" : ""}`} />
              {bulkSyncMut.isPending ? "Syncing…" : "Re-sync all to library"}
            </Button>
            <Button asChild data-testid="button-create-polaris-episode">
              <AppLink href="/library/polaris-episodes/new" asChild unstyled>
                <Plus className="h-4 w-4 mr-2" /> New episode
              </AppLink>
            </Button>
          </div>
        )
      }
    >
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-32">Service</TableHead>
              <TableHead className="w-40">Solution</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32">Library</TableHead>
              <TableHead className="w-36">Published</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No Polaris episodes yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((e) => {
                const sync = collateralByEpisodeId.get(e.id);
                const status: SyncStatus = sync?.status ?? "loading";
                const reason =
                  sync && sync.reasons.length > 0
                    ? sync.reasons.join(" ")
                    : undefined;
                const isSyncingThis =
                  singleSyncMut.isPending &&
                  singleSyncMut.variables === e.id;
                return (
                <TableRow key={e.id} data-testid={`row-polaris-${e.id}`}>
                  <TableCell className="font-mono">{e.episodeNumber}</TableCell>
                  <TableCell className="font-medium">
                    <AppLink
                      href={`/library/polaris-episodes/${e.id}/edit`}
                      data-testid={`link-edit-polaris-${e.id}`}
                    >
                      {e.title}
                    </AppLink>
                    <div className="text-xs text-muted-foreground font-mono">
                      /polaris/{e.slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.serviceId ? (serviceById.get(e.serviceId) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.solutionId ? (solutionById.get(e.solutionId) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABELS[e.status] ?? e.status}
                  </TableCell>
                  <TableCell>
                    <SyncStatusBadge
                      status={status}
                      onClick={canWrite ? () => onSyncOne(e) : undefined}
                      disabled={!canWrite || bulkSyncMut.isPending}
                      syncing={isSyncingThis}
                      testId={`badge-polaris-sync-${e.id}`}
                      reason={reason}
                    />
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.publishedAt
                      ? new Date(e.publishedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={e.active}
                      onCheckedChange={(next) => onToggleActive(e, next)}
                      disabled={!canWrite}
                      data-testid={`switch-polaris-active-${e.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {e.audioUrl && (
                        <a href={e.audioUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" title="Open audio URL">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      <Button asChild variant="ghost" size="icon">
                        <AppLink href={`/library/polaris-episodes/${e.id}/edit`} asChild unstyled>
                          <Pencil className="h-4 w-4" />
                        </AppLink>
                      </Button>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(e)}
                          data-testid={`button-delete-polaris-${e.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <PolarisLibsynImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </AdminLayout>
    </TooltipProvider>
  );
}
