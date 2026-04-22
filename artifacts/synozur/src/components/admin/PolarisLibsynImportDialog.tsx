import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  type PolarisLibsynPreviewItem,
  type PolarisLibsynImportSummary,
} from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PolarisLibsynImportDialog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const settingsQ = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
    enabled: open,
  });

  const [feedUrlDraft, setFeedUrlDraft] = useState("");
  const [previewData, setPreviewData] = useState<PolarisLibsynPreviewItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [allowResync, setAllowResync] = useState(false);

  useEffect(() => {
    if (open && settingsQ.data) {
      setFeedUrlDraft(settingsQ.data.polarisFeedUrl ?? "");
    }
  }, [open, settingsQ.data]);

  useEffect(() => {
    if (!open) {
      setPreviewData([]);
      setSelected({});
      setAllowResync(false);
    }
  }, [open]);

  const saveFeedMut = useMutation({
    mutationFn: (feedUrl: string) => {
      if (!settingsQ.data) {
        throw new Error("Site settings are still loading. Please try again.");
      }

      return api.updateAdminSiteSettings({
        requireCookieConsent: settingsQ.data.requireCookieConsent,
        polarisFeedUrl: feedUrl.trim() ? feedUrl.trim() : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-site-settings"] });
      toast({ title: "Feed URL saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const previewMut = useMutation({
    mutationFn: (feedUrl: string) => api.previewPolarisLibsyn(feedUrl || undefined),
    onSuccess: (data) => {
      setPreviewData(data.items);
      // Default selection: everything not yet in the DB.
      const next: Record<string, boolean> = {};
      for (const it of data.items) next[it.guid] = !it.existsInDb;
      setSelected(next);
    },
    onError: (e: Error) =>
      toast({ title: "Fetch failed", description: e.message, variant: "destructive" }),
  });

  const importMut = useMutation({
    mutationFn: (body: { guids: string[]; allowResync: boolean }) =>
      api.importPolarisLibsyn(body),
    onSuccess: (summary: PolarisLibsynImportSummary) => {
      toast({
        title: "Import complete",
        description: `Created ${summary.created}, updated ${summary.updated}, skipped ${summary.skipped}${
          summary.errors.length ? `, errors ${summary.errors.length}` : ""
        }.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] });
      // Refresh preview so existsInDb flags reflect new state.
      previewMut.mutate(feedUrlDraft);
    },
    onError: (e: Error) =>
      toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const selectedGuids = useMemo(
    () => Object.keys(selected).filter((g) => selected[g]),
    [selected],
  );

  const settingsFeedUrl = settingsQ.data?.polarisFeedUrl ?? "";
  const feedUrlDirty = feedUrlDraft.trim() !== (settingsFeedUrl ?? "").trim();

  const canFetch = feedUrlDraft.trim().length > 0 && !previewMut.isPending;
  const canImport = selectedGuids.length > 0 && !importMut.isPending;

  const toggleAll = (next: boolean) => {
    const out: Record<string, boolean> = {};
    for (const it of previewData) {
      if (!next) {
        out[it.guid] = false;
      } else if (it.existsInDb && !allowResync) {
        out[it.guid] = false;
      } else {
        out[it.guid] = true;
      }
    }
    setSelected(out);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import from Libsyn</DialogTitle>
          <DialogDescription>
            Fetch the Polaris RSS feed, pick the episodes you want, and pull them in as drafts.
            Existing episodes are skipped unless you enable re-sync.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="polaris-feed-url">Libsyn RSS feed URL</Label>
              <Input
                id="polaris-feed-url"
                value={feedUrlDraft}
                onChange={(e) => setFeedUrlDraft(e.target.value)}
                placeholder="https://feeds.libsyn.com/550947/rss"
                data-testid="input-polaris-feed-url"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => saveFeedMut.mutate(feedUrlDraft)}
              disabled={!feedUrlDirty || saveFeedMut.isPending}
              data-testid="button-save-polaris-feed-url"
            >
              {saveFeedMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              onClick={() => previewMut.mutate(feedUrlDraft)}
              disabled={!canFetch}
              data-testid="button-fetch-polaris-feed"
            >
              {previewMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" /> Fetch episodes
                </>
              )}
            </Button>
          </div>

          {previewData.length > 0 && (
            <>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allowResync}
                    onCheckedChange={(v) => setAllowResync(!!v)}
                    data-testid="checkbox-allow-resync"
                  />
                  Re-sync already-imported episodes (overwrites title, audio URL, pub date, duration,
                  artwork, summary)
                </label>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleAll(true)}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleAll(false)}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-border max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead className="w-32">Published</TableHead>
                      <TableHead className="w-24">Duration</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.map((it) => {
                      const locked = it.existsInDb && !allowResync;
                      return (
                        <TableRow
                          key={it.guid}
                          data-testid={`row-libsyn-${it.guid}`}
                          className={locked ? "opacity-60" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={!!selected[it.guid]}
                              disabled={locked}
                              onCheckedChange={(v) =>
                                setSelected((prev) => ({ ...prev, [it.guid]: !!v }))
                              }
                              data-testid={`checkbox-libsyn-${it.guid}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {it.episodeNumber ?? "—"}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{it.title}</div>
                            {it.summary && (
                              <div className="text-xs text-muted-foreground line-clamp-1">
                                {it.summary}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{formatDate(it.publishedAt)}</TableCell>
                          <TableCell className="text-sm font-mono">
                            {formatDuration(it.durationSeconds)}
                          </TableCell>
                          <TableCell>
                            {it.existsInDb ? (
                              <Badge variant="secondary">In library</Badge>
                            ) : (
                              <Badge>New</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() =>
              importMut.mutate({ guids: selectedGuids, allowResync })
            }
            disabled={!canImport}
            data-testid="button-import-polaris-selected"
          >
            {importMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" /> Import {selectedGuids.length} selected
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
