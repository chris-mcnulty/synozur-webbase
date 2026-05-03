import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  GripVertical,
  Trash2,
  FileText,
  ExternalLink,
  Plus,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCmsListCollateralResources,
  useCmsCreateCollateralResource,
  useCmsUpdateCollateralResource,
  useCmsDeleteCollateralResource,
  useCmsReorderCollateralResources,
  getCmsListCollateralResourcesQueryKey,
  type CollateralResource,
  type MediaItem,
} from "@workspace/api-client-react";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";

interface Props {
  collateralId: string;
  canWrite: boolean;
}

// #122 — Resources editor for a library item. Each row is either
// media-backed (linked to the unified `media` table; UI shows a media
// thumbnail-style chip) or an external URL (off-platform: GitHub, Figma,
// vendor CDNs). Drag-to-reorder follows the same pattern as
// OrderedBlocksEditor.
export function CollateralResourcesEditor({ collateralId, canWrite }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const listQ = useCmsListCollateralResources(collateralId, {
    query: { enabled: !!collateralId } as never,
  });
  const items: CollateralResource[] = listQ.data?.items ?? [];

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getCmsListCollateralResourcesQueryKey(collateralId) });

  const createMut = useCmsCreateCollateralResource({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: Error) =>
        toast({ title: "Add failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateMut = useCmsUpdateCollateralResource({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const deleteMut = useCmsDeleteCollateralResource({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });
  const reorderMut = useCmsReorderCollateralResources({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: Error) =>
        toast({ title: "Reorder failed", description: e.message, variant: "destructive" }),
    },
  });

  const [pickerForRow, setPickerForRow] = useState<string | null>(null);
  const [pickerForNew, setPickerForNew] = useState(false);
  const [externalDraftUrl, setExternalDraftUrl] = useState("");
  const [externalDraftLabel, setExternalDraftLabel] = useState("");

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleAddMedia = async (m: MediaItem) => {
    if (pickerForRow) {
      // Replacing an existing row's media binding.
      await updateMut.mutateAsync({
        id: collateralId,
        resourceId: pickerForRow,
        data: { mediaId: m.id, externalUrl: null },
      });
      setPickerForRow(null);
      return;
    }
    // Adding a brand new media-backed resource.
    await createMut.mutateAsync({
      id: collateralId,
      data: {
        mediaId: m.id,
        label: m.originalName ?? m.altText ?? "Download",
        mimeType: m.mime ?? null,
      },
    });
    setPickerForNew(false);
  };

  const handleAddExternal = async () => {
    const url = externalDraftUrl.trim();
    const label = externalDraftLabel.trim();
    if (!url || !label) return;
    await createMut.mutateAsync({
      id: collateralId,
      data: { externalUrl: url, label },
    });
    setExternalDraftUrl("");
    setExternalDraftLabel("");
  };

  const handleLabelBlur = (resource: CollateralResource, nextLabel: string) => {
    if (nextLabel.trim() === resource.label) return;
    if (!nextLabel.trim()) return;
    void updateMut.mutateAsync({
      id: collateralId,
      resourceId: resource.id,
      data: { label: nextLabel.trim() },
    });
  };

  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = items.findIndex((r) => r.id === dragId);
    const to = items.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    setOverId(null);
    await reorderMut.mutateAsync({
      id: collateralId,
      data: { ids: next.map((r) => r.id) },
    });
  };

  return (
    <div className="space-y-3">
      <div
        className="rounded-md border border-border divide-y divide-border bg-card"
        data-testid="collateral-resources-list"
      >
        {listQ.isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No resources yet. Attach a file or paste an external link below.
          </div>
        ) : (
          items.map((r) => (
            // Native HTML5 drag-and-drop reorder region. The drop handler is
            // a non-interactive surface (the row itself is not a button or
            // link); a separate drag-handle button is used for keyboard
            // reordering. The DnD listeners here are mouse-only and the
            // a11y rule's "needs role + keyboard" guidance does not fit
            // HTML5 DnD APIs.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              key={r.id}
              draggable={canWrite && items.length > 1}
              onDragStart={() => setDragId(r.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(r.id);
              }}
              onDragLeave={() => setOverId((o) => (o === r.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(r.id);
              }}
              className={`flex items-center gap-3 px-3 py-2 ${
                overId === r.id ? "bg-primary/5" : ""
              } ${dragId === r.id ? "opacity-60" : ""}`}
              data-testid={`collateral-resource-row-${r.id}`}
            >
              <button
                type="button"
                className="text-muted-foreground cursor-grab disabled:opacity-30"
                disabled={!canWrite || items.length < 2}
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <div className="w-9 h-9 rounded border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {r.mediaId ? (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <Input
                defaultValue={r.label}
                onBlur={(e) => handleLabelBlur(r, e.target.value)}
                disabled={!canWrite}
                className="flex-1 min-w-0"
                data-testid={`collateral-resource-label-${r.id}`}
              />
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground truncate max-w-[180px]"
                title={r.url}
              >
                {r.url}
              </a>
              {canWrite && r.mediaId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPickerForRow(r.id)}
                  data-testid={`collateral-resource-replace-${r.id}`}
                >
                  Replace
                </Button>
              )}
              {canWrite && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm(`Remove "${r.label}"?`))
                      void deleteMut.mutateAsync({ id: collateralId, resourceId: r.id });
                  }}
                  aria-label="Remove resource"
                  data-testid={`collateral-resource-delete-${r.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {canWrite && (
        <div className="rounded-md border border-dashed border-border p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerForNew(true)}
              data-testid="collateral-resource-add-media"
            >
              <ImageIcon className="h-4 w-4 mr-1" /> Attach media…
            </Button>
            <span className="text-xs text-muted-foreground">
              or add an external link:
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Label (e.g. Slides)"
              value={externalDraftLabel}
              onChange={(e) => setExternalDraftLabel(e.target.value)}
              className="sm:w-44"
              data-testid="collateral-resource-new-label"
            />
            <Input
              placeholder="https://github.com/..."
              value={externalDraftUrl}
              onChange={(e) => setExternalDraftUrl(e.target.value)}
              className="flex-1"
              data-testid="collateral-resource-new-url"
            />
            <Button
              type="button"
              onClick={() => void handleAddExternal()}
              disabled={!externalDraftLabel.trim() || !externalDraftUrl.trim()}
              data-testid="collateral-resource-add-external"
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The first resource (drag to reorder) becomes the public detail page's
            primary "Download" CTA.
          </p>
        </div>
      )}

      <MediaPickerModal
        open={pickerForNew || !!pickerForRow}
        onClose={() => {
          setPickerForNew(false);
          setPickerForRow(null);
        }}
        onSelect={handleAddMedia}
        title="Attach media as a resource"
      />
    </div>
  );
}

export default CollateralResourcesEditor;
