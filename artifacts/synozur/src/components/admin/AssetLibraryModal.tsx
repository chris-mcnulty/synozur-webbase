import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ObjectUploader } from "@workspace/object-storage-web";
import { Trash2, Upload, Search, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { Asset } from "@workspace/api-zod/types";
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  type AssetCategory,
} from "@workspace/api-zod";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function assetUrl(asset: Asset): string {
  return `${BASE_PATH}/api/storage${asset.storageKey}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: Asset) => void;
  selectedId?: number | null;
  /**
   * Optional category filter preset. When set, the library is locked to that
   * category and new uploads are automatically tagged with it. When omitted,
   * editors can filter and tag uploads using the in-modal category dropdown.
   */
  category?: AssetCategory;
}

const ANY_CATEGORY = "__any__";

export function AssetLibraryModal({ open, onClose, onSelect, selectedId, category }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<number | null>(selectedId ?? null);
  const [filterCategory, setFilterCategory] = useState<AssetCategory | null>(null);
  const [uploadCategory, setUploadCategory] = useState<AssetCategory | null>(null);
  const qc = useQueryClient();

  const locked = !!category;
  const activeCategory: AssetCategory | undefined = category ?? filterCategory ?? undefined;
  const uploadAs: AssetCategory | undefined =
    category ?? uploadCategory ?? filterCategory ?? undefined;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (open) setPicked(selectedId ?? null);
  }, [open, selectedId]);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", debounced, activeCategory ?? null],
    queryFn: () => api.listAssets(debounced || undefined, activeCategory),
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  const createAsset = useMutation({
    mutationFn: api.createAsset,
    onSuccess: (asset) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setPicked(asset.id);
    },
  });

  const sortedAssets = useMemo(
    () =>
      [...assets].sort(
        (a, b) =>
          new Date(b.uploadedAt as unknown as string).getTime() -
          new Date(a.uploadedAt as unknown as string).getTime(),
      ),
    [assets],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Asset Library</DialogTitle>
        </DialogHeader>

        {locked && category && (
          <div className="text-xs text-muted-foreground">
            Filtered to <span className="font-medium">{ASSET_CATEGORY_LABELS[category]}</span>.
            Uploads will be tagged with this category.
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-asset-search"
            />
          </div>
          {!locked && (
            <Select
              value={filterCategory ?? ANY_CATEGORY}
              onValueChange={(v) =>
                setFilterCategory(v === ANY_CATEGORY ? null : (v as AssetCategory))
              }
            >
              <SelectTrigger className="w-44" data-testid="select-asset-category-filter">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_CATEGORY}>All categories</SelectItem>
                {ASSET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!locked && (
            <Select
              value={uploadCategory ?? ANY_CATEGORY}
              onValueChange={(v) =>
                setUploadCategory(v === ANY_CATEGORY ? null : (v as AssetCategory))
              }
            >
              <SelectTrigger className="w-44" data-testid="select-asset-upload-category">
                <SelectValue placeholder="Tag upload as…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_CATEGORY}>Untagged</SelectItem>
                {ASSET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ObjectUploader
            maxNumberOfFiles={5}
            maxFileSize={10 * 1024 * 1024}
            buttonClassName="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            onGetUploadParameters={async (file) => {
              const { uploadURL } = await api.requestUploadUrl({
                name: String(file.name ?? "file"),
                size: Number(file.size ?? 0),
                contentType: String(file.type ?? "application/octet-stream"),
              });
              return { method: "PUT", url: uploadURL };
            }}
            onComplete={async (result) => {
              for (const f of (result.successful ?? []) as unknown as Array<Record<string, unknown>>) {
                const uploadURL = (f.uploadURL as string | undefined) ?? "";
                if (!uploadURL) continue;
                // Re-call request to normalize the path? Easier: parse storage key from URL.
                // Strip query and host to get the object path.
                let pathOnly = "";
                try {
                  pathOnly = new URL(uploadURL).pathname;
                } catch {
                  pathOnly = uploadURL;
                }
                // Extract the bucket-relative path: storage URL form
                // /storage/v1/b/<bucket>/o/<encoded-path>; we want the object path.
                // Fallback: ask backend by re-requesting through storage path mapping.
                const match = pathOnly.match(/\/o\/(.+)$/);
                const objectName = match ? decodeURIComponent(match[1]) : pathOnly;
                // Convert to "/objects/uploads/<id>" by extracting the uuid portion.
                const uploadsIdx = objectName.lastIndexOf("/");
                const id = uploadsIdx >= 0 ? objectName.slice(uploadsIdx + 1) : objectName;
                const storageKey = `/objects/uploads/${id}`;
                await createAsset.mutateAsync({
                  originalName: String(f.name ?? "file"),
                  mimeType: String(f.type ?? "application/octet-stream"),
                  size: Number(f.size ?? 0),
                  storageKey,
                  ...(uploadAs ? { category: uploadAs } : {}),
                });
              }
            }}
          >
            <Upload className="h-4 w-4" />
            <span>Upload</span>
          </ObjectUploader>
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-2">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : sortedAssets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No assets yet. Upload one to get started.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 py-2">
              {sortedAssets.map((a) => {
                const isPicked = picked === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setPicked(a.id)}
                    className={`group relative aspect-square rounded-md overflow-hidden border-2 ${
                      isPicked ? "border-primary" : "border-border"
                    } hover-elevate`}
                    data-testid={`asset-item-${a.id}`}
                  >
                    {a.mimeType.startsWith("image/") ? (
                      <img
                        src={assetUrl(a)}
                        alt={a.originalName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground p-2 break-all">
                        {a.originalName}
                      </div>
                    )}
                    {isPicked && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${a.originalName}?`)) {
                          deleteMutation.mutate(a.id);
                          if (picked === a.id) setPicked(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          if (confirm(`Delete ${a.originalName}?`)) {
                            deleteMutation.mutate(a.id);
                            if (picked === a.id) setPicked(null);
                          }
                        }
                      }}
                      className="absolute top-2 left-2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      data-testid={`asset-delete-${a.id}`}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-asset-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => {
              const found = sortedAssets.find((a) => a.id === picked);
              if (found) {
                onSelect(found);
                onClose();
              }
            }}
            disabled={picked == null}
            data-testid="button-asset-select"
          >
            Select Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
