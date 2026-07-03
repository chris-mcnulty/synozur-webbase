import { useEffect, useState, useRef, useMemo } from "react";
import { ObjectUploader } from "@workspace/object-storage-web";
import { Search, Upload, Check, Copy, X, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useListCmsMedia,
  useRegisterCmsMedia,
  useListAssetCategories,
  useBulkSetMediaCategory,
  getListAssetCategoriesQueryKey,
  getListCmsMediaQueryKey,
} from "@workspace/api-client-react";
import type { MediaItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { resolveStoragePath, withWidth } from "@/lib/media-url";
import {
  type AssetKind,
  isDocumentMime,
  isImageMime,
  isVideoMime,
  IMAGE_ACCEPT_TYPES,
  DOCUMENT_ACCEPT_TYPES,
  VIDEO_ACCEPT_TYPES,
} from "@/lib/asset-kind";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_BYTES = IMAGE_MAX_BYTES;

export function mediaUrl(
  m: string | { storageKey: string | null; publicUrl?: string | null },
  options?: { width?: number },
): string {
  let resolved = "";
  if (typeof m === "string") {
    if (!m) return "";
    resolved = resolveStoragePath(m);
  } else if (m.publicUrl) {
    resolved = resolveStoragePath(m.publicUrl);
  } else if (m.storageKey) {
    resolved = m.storageKey.startsWith("http")
      ? m.storageKey
      : `${BASE_PATH}/api/storage${m.storageKey}`;
  }
  if (!resolved) return "";
  return withWidth(resolved, options?.width);
}

function absoluteMediaUrl(m: MediaItem): string {
  const path = mediaUrl(m);
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${window.location.origin}${path}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (media: MediaItem) => void;
  selectedId?: string | null;
  title?: string;
  categorySlug?: string;
  kind?: AssetKind;
}

const FILTER_ALL = "__all__";
const FILTER_NONE = "__none__";
const FILTER_UNCATEGORIZED = "__uncategorized__";

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  selectedId,
  title = "Media Library",
  categorySlug,
  kind,
}: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(FILTER_ALL);
  const [uploadCategoryId, setUploadCategoryId] = useState<string>(FILTER_NONE);
  const [picked, setPicked] = useState<string | null>(selectedId ?? null);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>(FILTER_NONE);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 350);
  };

  const { data: catsData } = useListAssetCategories({
    query: { queryKey: getListAssetCategoriesQueryKey(), enabled: open },
  });
  const categories = catsData?.items ?? [];

  const initialCategoryId = categorySlug
    ? categories.find((c) => c.slug === categorySlug)?.id
    : undefined;

  const isUncategorized = categoryFilter === FILTER_UNCATEGORIZED;
  const resolvedCategoryId =
    categoryFilter === FILTER_ALL
      ? initialCategoryId
      : categoryFilter === FILTER_NONE || isUncategorized
        ? undefined
        : categoryFilter;

  const { data, isLoading, refetch } = useListCmsMedia(
    {
      pageSize: 500,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(isUncategorized ? { uncategorized: true } : {}),
      ...(resolvedCategoryId ? { categoryId: resolvedCategoryId } : {}),
    },
    { query: { enabled: open } as never },
  );

  const register = useRegisterCmsMedia({
    mutation: {
      onSuccess: (m) => {
        setPicked(m.id);
        refetch();
      },
    },
  });

  const bulkMutation = useBulkSetMediaCategory({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Categories updated",
          description: `${result.updated} ${result.updated === 1 ? "image" : "images"} updated.`,
        });
        setSelectedIds(new Set());
        setBulkCategoryId(FILTER_NONE);
        qc.invalidateQueries({ queryKey: getListCmsMediaQueryKey() });
        refetch();
      },
      onError: () => {
        toast({
          title: "Update failed",
          description: "Could not update categories. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    if (open) {
      setPicked(selectedId ?? null);
      setSearch("");
      setDebouncedSearch("");
      setCategoryFilter(FILTER_ALL);
      setUploadCategoryId(FILTER_NONE);
      setSelectedIds(new Set());
      setBulkCategoryId(FILTER_NONE);
      setLightboxItem(null);
    }
  }, [open, selectedId]);

  useEffect(() => {
    if (!open) return;
    if (categorySlug && categories.length > 0) {
      const match = categories.find((c) => c.slug === categorySlug);
      if (match) setUploadCategoryId(match.id);
    }
  }, [open, categorySlug, categories]);

  const allItems = data?.items ?? [];
  const items = useMemo(() => {
    if (!kind) return allItems;
    return allItems.filter((m) => {
      const mime = m.mime ?? "";
      if (kind === "image") return isImageMime(mime);
      if (kind === "document") return isDocumentMime(mime);
      if (kind === "video") return isVideoMime(mime);
      return true;
    });
  }, [allItems, kind]);

  const uploadAcceptTypes =
    kind === "document"
      ? DOCUMENT_ACCEPT_TYPES
      : kind === "video"
        ? VIDEO_ACCEPT_TYPES
        : kind === "image"
          ? IMAGE_ACCEPT_TYPES
          : undefined;
  const uploadMaxBytes =
    kind === "document"
      ? DOCUMENT_MAX_BYTES
      : kind === "video"
        ? VIDEO_MAX_BYTES
        : kind === "image"
          ? IMAGE_MAX_BYTES
          : DEFAULT_MAX_BYTES;

  const toggleSelectId = (id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApplyBulk = () => {
    if (selectedIds.size === 0) return;
    bulkMutation.mutate({
      data: {
        ids: [...selectedIds],
        categoryId: bulkCategoryId !== FILTER_NONE ? bulkCategoryId : null,
      },
    });
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    });
  };

  const categoryLabelById = new Map(categories.map((c) => [c.id, c.label]));

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          {/* Filter / upload bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name…"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
                data-testid="input-media-search"
              />
            </div>
            {categories.length > 0 && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44" data-testid="select-media-category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All categories</SelectItem>
                  <SelectItem value={FILTER_UNCATEGORIZED}>Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {categories.length > 0 && (
                <>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Save to:</span>
                  <Select value={uploadCategoryId} onValueChange={setUploadCategoryId}>
                    <SelectTrigger className="w-36 h-10" data-testid="select-upload-category">
                      <SelectValue placeholder="No category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_NONE}>No category</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <ObjectUploader
                maxNumberOfFiles={5}
                maxFileSize={uploadMaxBytes}
                allowedFileTypes={uploadAcceptTypes}
                buttonClassName="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                onGetUploadParameters={async (file) => {
                  const { uploadURL } = await api.requestUploadUrl({
                    name: String(file.name ?? "file"),
                    size: Number(file.size ?? 0),
                    contentType: String(file.type ?? "application/octet-stream"),
                  });
                  const absURL = uploadURL.startsWith("/")
                    ? `${window.location.origin}${uploadURL}`
                    : uploadURL;
                  return { method: "PUT", url: absURL };
                }}
                onComplete={async (result) => {
                  for (const f of (result.successful ?? []) as unknown as Array<
                    Record<string, unknown>
                  >) {
                    const uploadURL = (f.uploadURL as string | undefined) ?? "";
                    if (!uploadURL) continue;
                    let pathOnly = "";
                    try {
                      pathOnly = new URL(uploadURL).pathname;
                    } catch {
                      pathOnly = uploadURL;
                    }
                    const match = pathOnly.match(/\/o\/(.+)$/);
                    const objectName = match ? decodeURIComponent(match[1]) : pathOnly;
                    const slashIdx = objectName.lastIndexOf("/");
                    const id = slashIdx >= 0 ? objectName.slice(slashIdx + 1) : objectName;
                    const storageKey = `/objects/uploads/${id}`;
                    const publicUrl = `/api/storage${storageKey}`;
                    const fileName = String(f.name ?? "");
                    const placeholderAlt = fileName.replace(/\.[^./\\]+$/, "").trim();
                    await register.mutateAsync({
                      data: {
                        storageKey,
                        publicUrl,
                        mime: String(f.type ?? "application/octet-stream"),
                        byteSize: Number(f.size ?? 0),
                        altText: placeholderAlt
                          ? `Image: ${placeholderAlt}`
                          : "Image: untitled",
                        originalName: fileName || undefined,
                        categoryId:
                          uploadCategoryId !== FILTER_NONE ? uploadCategoryId : undefined,
                      },
                    });
                  }
                }}
              >
                <Upload className="h-4 w-4" />
                <span>Upload</span>
              </ObjectUploader>
            </div>
          </div>

          {/* Item count */}
          {!isLoading && (
            <p className="text-xs text-muted-foreground -mt-1">
              {items.length} {items.length === 1 ? "item" : "items"}
              {debouncedSearch || resolvedCategoryId || isUncategorized
                ? " matching filter"
                : ""}
            </p>
          )}

          {/* Bulk action toolbar */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <Tag className="h-4 w-4 text-primary shrink-0" />
              <span className="font-medium text-primary">
                {selectedIds.size} selected
              </span>
              <span className="text-muted-foreground">— assign category:</span>
              <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
                <SelectTrigger className="h-8 w-44" data-testid="select-bulk-category">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_NONE}>No category (clear)</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleApplyBulk}
                disabled={bulkMutation.isPending}
                data-testid="button-bulk-apply"
              >
                Apply to selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          )}

          {/* Grid */}
          <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-2">
            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {debouncedSearch
                  ? `No results for "${debouncedSearch}". Try a different term.`
                  : isUncategorized
                    ? "No uncategorized images."
                    : "No media yet. Upload to get started."}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 py-2">
                {items.map((m) => {
                  const isPicked = picked === m.id;
                  const isSelected = selectedIds.has(m.id);
                  const isImage = (m.mime ?? "").startsWith("image/");
                  const inSelectionMode = selectedIds.size > 0;
                  return (
                    <div key={m.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setLightboxItem(m)}
                        className={`relative w-full aspect-square rounded-md overflow-hidden border-2 transition-all ${
                          isPicked
                            ? "border-primary"
                            : isSelected
                              ? "border-primary/60 ring-2 ring-primary/30"
                              : "border-border"
                        } hover:border-primary/50 hover-elevate`}
                        data-testid={`media-item-${m.id}`}
                      >
                        {isImage ? (
                          <img
                            src={mediaUrl(m, { width: 200 })}
                            alt={m.altText ?? ""}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground p-1 break-all leading-tight">
                            {m.storageKey.split("/").pop()}
                          </div>
                        )}
                        {isPicked && !isSelected && (
                          <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
                            <Check className="h-2.5 w-2.5" />
                          </div>
                        )}
                      </button>

                      {/* Checkbox for bulk selection */}
                      <label
                        className={`absolute top-1 left-1 flex items-center justify-center w-5 h-5 rounded cursor-pointer transition-opacity ${
                          inSelectionMode || isSelected
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelectId(m.id, e)}
                          className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          data-testid={`checkbox-media-${m.id}`}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={onClose}
              data-testid="button-media-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const found = items.find((m) => m.id === picked);
                if (found) {
                  onSelect(found);
                  onClose();
                }
              }}
              disabled={picked == null}
              data-testid="button-media-select"
            >
              Select
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxItem && (
        <Dialog
          open={!!lightboxItem}
          onOpenChange={(o) => {
            if (!o) setLightboxItem(null);
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="truncate text-sm font-medium">
                {lightboxItem.originalName ?? lightboxItem.storageKey.split("/").pop()}
              </DialogTitle>
            </DialogHeader>

            {/* Full image */}
            {(lightboxItem.mime ?? "").startsWith("image/") && (
              <div className="flex-1 overflow-hidden rounded-md bg-muted/40 flex items-center justify-center min-h-0">
                <img
                  src={mediaUrl(lightboxItem)}
                  alt={lightboxItem.altText ?? ""}
                  className="max-w-full max-h-[50vh] object-contain"
                />
              </div>
            )}

            {/* Metadata */}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mt-1">
              {lightboxItem.altText && (
                <>
                  <span className="text-muted-foreground font-medium whitespace-nowrap">Alt text</span>
                  <span className="break-words">{lightboxItem.altText}</span>
                </>
              )}
              {(lightboxItem.width || lightboxItem.height) && (
                <>
                  <span className="text-muted-foreground font-medium">Dimensions</span>
                  <span>
                    {lightboxItem.width ?? "?"}×{lightboxItem.height ?? "?"} px
                  </span>
                </>
              )}
              {lightboxItem.byteSize && (
                <>
                  <span className="text-muted-foreground font-medium">Size</span>
                  <span>{(lightboxItem.byteSize / 1024).toFixed(0)} KB</span>
                </>
              )}
              {lightboxItem.categoryId && (
                <>
                  <span className="text-muted-foreground font-medium">Category</span>
                  <span>
                    {categoryLabelById.get(lightboxItem.categoryId) ?? lightboxItem.categoryId}
                  </span>
                </>
              )}
              <>
                <span className="text-muted-foreground font-medium">URL</span>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="flex-1 truncate text-xs bg-muted px-2 py-1 rounded font-mono">
                    {absoluteMediaUrl(lightboxItem)}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 gap-1.5"
                    onClick={() => handleCopyUrl(absoluteMediaUrl(lightboxItem))}
                    data-testid="button-lightbox-copy-url"
                  >
                    {copiedUrl ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedUrl ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </>
            </div>

            <DialogFooter className="mt-2">
              <Button
                variant="outline"
                onClick={() => setLightboxItem(null)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setPicked(lightboxItem.id);
                  onSelect(lightboxItem);
                  setLightboxItem(null);
                  onClose();
                }}
                data-testid="button-lightbox-select"
              >
                Use this image
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export async function uploadAndRegisterImage(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const { uploadURL } = await api.requestUploadUrl({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        });
        const absUploadURL = uploadURL.startsWith("/")
          ? `${window.location.origin}${uploadURL}`
          : uploadURL;
        const putRes = await fetch(absUploadURL, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) {
          resolve(null);
          return;
        }
        const pathOnly = new URL(absUploadURL).pathname;
        const match = pathOnly.match(/\/o\/(.+)$/);
        const objectName = match ? decodeURIComponent(match[1]) : pathOnly;
        const slashIdx = objectName.lastIndexOf("/");
        const id = slashIdx >= 0 ? objectName.slice(slashIdx + 1) : objectName;
        const storageKey = `/objects/uploads/${id}`;
        const publicUrl = `/api/storage${storageKey}`;
        const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
        const res = await fetch(`${apiBase}/api/cms/media`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey,
            publicUrl,
            mime: file.type || "application/octet-stream",
            byteSize: file.size,
            altText: file.name,
          }),
        });
        if (!res.ok) {
          resolve(null);
          return;
        }
        const m = (await res.json()) as { storageKey: string; publicUrl: string };
        resolve(mediaUrl(m));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
