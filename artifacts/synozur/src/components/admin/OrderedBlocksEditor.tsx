import { useEffect, useMemo, useState } from "react";
import {
  GripVertical,
  History,
  Pencil,
  Plus,
  Trash2,
  X,
  Image as ImageIcon,
  Save,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import {
  MediaPickerModal,
  mediaUrl,
  uploadAndRegisterImage,
} from "@/components/admin/MediaPickerModal";
import type { MediaItem } from "@workspace/api-client-react";

export interface OrderedBlock {
  id: string;
  title: string;
  displayOrder: number;
  iconId?: string | null;
  iconUrl?: string | null;
  bodyHtml?: string | null;
  hidden: boolean;
}

interface BlockUpdate {
  title?: string;
  displayOrder?: number;
  iconId?: string | null;
  bodyHtml?: string | null;
  hidden?: boolean;
}

interface Props {
  blocks: OrderedBlock[];
  canWrite: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  onCreate: (data: { title: string }) => Promise<OrderedBlock | void>;
  onUpdate: (id: string, data: BlockUpdate) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onReorder: (
    items: { id: string; displayOrder: number }[],
  ) => Promise<void> | void;
  /**
   * #61: optional handler to open a per-block revision history dialog. When
   * provided, every row gets a clock icon next to the edit button.
   */
  onShowHistory?: (id: string) => void;
  testIdPrefix: string;
}

export function OrderedBlocksEditor({
  blocks,
  canWrite,
  isLoading,
  emptyMessage,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onShowHistory,
  testIdPrefix,
}: Props) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [iconForId, setIconForId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [orderedLocal, setOrderedLocal] = useState<OrderedBlock[]>(blocks);

  useEffect(() => {
    setOrderedLocal(blocks);
  }, [blocks]);

  const editing = editingId ? orderedLocal.find((b) => b.id === editingId) ?? null : null;

  const isFiltering = search.trim().length > 0;
  const visibleBlocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderedLocal;
    return orderedLocal.filter((b) => (b.title ?? "").toLowerCase().includes(q));
  }, [orderedLocal, search]);

  const handleAdd = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    await onCreate({ title: t });
  };

  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = orderedLocal.findIndex((b) => b.id === dragId);
    const to = orderedLocal.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...orderedLocal];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const renumbered = next.map((b, i) => ({ ...b, displayOrder: i + 1 }));
    setOrderedLocal(renumbered);
    setDragId(null);
    setOverId(null);
    await onReorder(renumbered.map((b) => ({ id: b.id, displayOrder: b.displayOrder })));
  };

  const handleIcon = async (m: MediaItem) => {
    if (!iconForId) return;
    setIconForId(null);
    await onUpdate(iconForId, { iconId: m.id });
    setOrderedLocal((cur) =>
      cur.map((b) =>
        b.id === iconForId ? { ...b, iconId: m.id, iconUrl: mediaUrl(m) } : b,
      ),
    );
  };

  const removeIcon = async (id: string) => {
    await onUpdate(id, { iconId: null });
    setOrderedLocal((cur) =>
      cur.map((b) => (b.id === id ? { ...b, iconId: null, iconUrl: null } : b)),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search blocks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid={`${testIdPrefix}-search`}
          />
        </div>
        {isFiltering && (
          <span className="text-xs text-muted-foreground">
            {visibleBlocks.length} of {orderedLocal.length} matching · drag-to-reorder paused
          </span>
        )}
      </div>
      <div
        className="rounded-md border border-border divide-y divide-border bg-card"
        data-testid={`${testIdPrefix}-list`}
      >
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : visibleBlocks.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {isFiltering ? "No blocks match this search." : emptyMessage ?? "No blocks yet."}
          </div>
        ) : (
          visibleBlocks.map((b) => (
            <div
              key={b.id}
              draggable={canWrite && !isFiltering}
              onDragStart={() => setDragId(b.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(b.id);
              }}
              onDragLeave={() => setOverId((o) => (o === b.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(b.id);
              }}
              className={`flex items-center gap-3 px-3 py-2 ${
                overId === b.id ? "bg-primary/5" : ""
              } ${dragId === b.id ? "opacity-60" : ""}`}
              data-testid={`${testIdPrefix}-row-${b.id}`}
            >
              <button
                type="button"
                className="text-muted-foreground cursor-grab disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!canWrite || isFiltering}
                aria-label={
                  isFiltering ? "Reordering disabled while filtering" : "Drag to reorder"
                }
                data-testid={`${testIdPrefix}-drag-${b.id}`}
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="w-10 h-10 rounded border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0 hover-elevate"
                disabled={!canWrite}
                onClick={() => setIconForId(b.id)}
                data-testid={`${testIdPrefix}-icon-${b.id}`}
              >
                {b.iconUrl ? (
                  <img src={b.iconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {canWrite && b.iconUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeIcon(b.id)}
                  aria-label="Remove icon"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <Input
                value={b.title}
                onChange={(e) => {
                  const v = e.target.value;
                  setOrderedLocal((cur) =>
                    cur.map((x) => (x.id === b.id ? { ...x, title: v } : x)),
                  );
                }}
                onBlur={(e) => {
                  if (e.target.value !== blocks.find((x) => x.id === b.id)?.title) {
                    void onUpdate(b.id, { title: e.target.value });
                  }
                }}
                disabled={!canWrite}
                className="flex-1 min-w-0"
                data-testid={`${testIdPrefix}-title-${b.id}`}
              />
              <div className="flex items-center gap-2 shrink-0">
                <Label className="text-xs text-muted-foreground">Hidden</Label>
                <Switch
                  checked={b.hidden}
                  onCheckedChange={(v) => {
                    setOrderedLocal((cur) =>
                      cur.map((x) => (x.id === b.id ? { ...x, hidden: v } : x)),
                    );
                    void onUpdate(b.id, { hidden: v });
                  }}
                  disabled={!canWrite}
                  data-testid={`${testIdPrefix}-hidden-${b.id}`}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setEditingId(b.id)}
                data-testid={`${testIdPrefix}-edit-${b.id}`}
                aria-label="Edit body"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {onShowHistory && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onShowHistory(b.id)}
                  data-testid={`${testIdPrefix}-history-${b.id}`}
                  aria-label="Revision history"
                >
                  <History className="h-4 w-4" />
                </Button>
              )}
              {canWrite && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm(`Delete "${b.title}"?`)) void onDelete(b.id);
                  }}
                  data-testid={`${testIdPrefix}-delete-${b.id}`}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {canWrite && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a new block…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
            data-testid={`${testIdPrefix}-new-title`}
          />
          <Button onClick={() => void handleAdd()} data-testid={`${testIdPrefix}-add`}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      )}

      <BodyEditorDialog
        block={editing}
        canWrite={canWrite}
        onClose={() => setEditingId(null)}
        onSave={async (html) => {
          if (!editingId) return;
          await onUpdate(editingId, { bodyHtml: html });
          setOrderedLocal((cur) =>
            cur.map((x) => (x.id === editingId ? { ...x, bodyHtml: html } : x)),
          );
          setEditingId(null);
        }}
      />

      <MediaPickerModal
        open={!!iconForId}
        onClose={() => setIconForId(null)}
        onSelect={handleIcon}
        selectedId={iconForId ? orderedLocal.find((b) => b.id === iconForId)?.iconId ?? null : null}
        title="Choose icon"
      />
    </div>
  );
}

function BodyEditorDialog({
  block,
  canWrite,
  onClose,
  onSave,
}: {
  block: OrderedBlock | null;
  canWrite: boolean;
  onClose: () => void;
  onSave: (html: string) => Promise<void> | void;
}) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    setHtml(block?.bodyHtml ?? "");
  }, [block?.id, block?.bodyHtml]);

  return (
    <Dialog open={!!block} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{block?.title ?? "Edit body"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {canWrite ? (
            <RichTextEditor
              value={html}
              onChange={({ html: h }) => setHtml(h)}
              onUploadImage={uploadAndRegisterImage}
            />
          ) : (
            <div
              className="prose prose-invert max-w-none rounded-md border border-border bg-muted/30 p-4"
              data-testid="block-body-readonly"
              dangerouslySetInnerHTML={{ __html: html || "<p><em>No content.</em></p>" }}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {canWrite && (
            <Button onClick={() => void onSave(html)} data-testid="button-save-body">
              <Save className="h-4 w-4 mr-1" /> Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
