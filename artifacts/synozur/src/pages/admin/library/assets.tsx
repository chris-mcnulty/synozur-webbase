import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ObjectUploader } from "@workspace/object-storage-web";
import {
  Search,
  Upload,
  Trash2,
  Copy,
  Check,
  Loader2,
  Tags,
  FileText,
  AlertTriangle,
  ZoomIn,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { AssetCategoriesModal } from "@/components/admin/AssetCategoriesModal";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/asset-kind";
import { resolveStoragePath, withWidth } from "@/lib/media-url";
import {
  useListAssetCategories,
  useListLibraryAssets,
  useRegisterCmsMedia,
  useUpdateCmsMedia,
  useDeleteCmsMedia,
  useUpdateAsset,
  useDeleteAsset,
  getListLibraryAssetsQueryKey,
  type LibraryAssetItem,
  type AssetCategory,
} from "@workspace/api-client-react";

const ANY_CATEGORY = "__any__";
const NONE_CATEGORY = "__none__";
const UNCATEGORIZED = "__uncategorized__";
const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function itemUrl(item: LibraryAssetItem, options?: { width?: number }): string {
  let resolved = "";
  if (item.publicUrl) {
    resolved = resolveStoragePath(item.publicUrl);
  } else if (item.storageKey.startsWith("http")) {
    resolved = item.storageKey;
  } else {
    resolved = `${BASE_PATH}/api/storage${item.storageKey}`;
  }
  return withWidth(resolved, options?.width);
}

function absoluteItemUrl(item: LibraryAssetItem): string {
  const path = itemUrl(item);
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${window.location.origin}${path}`;
}

function displayName(item: LibraryAssetItem): string {
  return (
    item.originalName ??
    item.altText ??
    item.storageKey.split("/").pop() ??
    "(unnamed)"
  );
}

function isPlaceholderAlt(altText: string | null | undefined): boolean {
  if (!altText) return true;
  return /^Image:\s/.test(altText.trim());
}

export default function AssetsLibrary() {
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ANY_CATEGORY);
  const [source, setSource] = useState<"all" | "asset" | "media">("all");
  const [catsModalOpen, setCatsModalOpen] = useState(false);
  const [uploadCategoryId, setUploadCategoryId] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<LibraryAssetItem | null>(null);
  const [copiedLightbox, setCopiedLightbox] = useState(false);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListLibraryAssetsQueryKey() });

  const { data: cats } = useListAssetCategories();
  const categories: AssetCategory[] = [...(cats?.items ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );

  const isUncategorized = categoryId === UNCATEGORIZED;

  const { data, isLoading } = useListLibraryAssets({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(isUncategorized
      ? { uncategorized: true }
      : categoryId !== ANY_CATEGORY
        ? { categoryId }
        : {}),
    source,
  });

  const items = data?.items ?? [];

  const register = useRegisterCmsMedia({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Upload registered" });
      },
      onError: (e: Error) =>
        toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const updateMedia = useUpdateCmsMedia({
    mutation: {
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const deleteMedia = useDeleteCmsMedia({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Deleted" });
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateAsset = useUpdateAsset({
    mutation: {
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const deleteAsset = useDeleteAsset({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Deleted" });
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const handleSaveAlt = async (item: LibraryAssetItem, altText: string) => {
    if (item.source === "media") {
      await updateMedia.mutateAsync({ id: item.id, data: { altText } });
    } else {
      await updateAsset.mutateAsync({
        id: Number(item.id),
        data: { altText },
      });
    }
    await invalidate();
  };

  const handleChangeCategory = async (
    item: LibraryAssetItem,
    nextCategoryId: string | null,
  ) => {
    if (item.source === "media") {
      await updateMedia.mutateAsync({
        id: item.id,
        data: { categoryId: nextCategoryId },
      });
    } else {
      await updateAsset.mutateAsync({
        id: Number(item.id),
        data: { categoryId: nextCategoryId },
      });
    }
    await invalidate();
  };

  const handleDelete = (item: LibraryAssetItem) => {
    if (!confirm(`Delete "${displayName(item)}"? This cannot be undone.`)) return;
    if (item.source === "media") {
      deleteMedia.mutate({ id: item.id });
    } else {
      deleteAsset.mutate({ id: Number(item.id) });
    }
  };

  const handleCopyLightboxUrl = () => {
    if (!lightboxItem) return;
    const url = absoluteItemUrl(lightboxItem);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLightbox(true);
      setTimeout(() => setCopiedLightbox(false), 1500);
    });
  };

  return (
    <AdminLayout
      title="Asset Library"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Library" }, { label: "Assets" }]}
      actions={
        <>
          {access?.isAdmin ? (
            <Button
              variant="outline"
              onClick={() => setCatsModalOpen(true)}
              data-testid="button-manage-asset-categories"
            >
              <Tags className="h-4 w-4 mr-1" /> Manage Categories
            </Button>
          ) : null}
          <ObjectUploader
            maxNumberOfFiles={20}
            maxFileSize={50 * 1024 * 1024}
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
                const originalName = String(f.name ?? "file");
                const altBase = originalName.replace(/\.[^./\\]+$/, "").trim();
                const altText = altBase
                  ? `Image: ${altBase}`
                  : "Image: untitled";
                await register.mutateAsync({
                  data: {
                    storageKey,
                    publicUrl,
                    mime: String(f.type ?? "application/octet-stream"),
                    byteSize: Number(f.size ?? 0),
                    altText,
                    originalName,
                    ...(uploadCategoryId ? { categoryId: uploadCategoryId } : {}),
                  },
                });
              }
            }}
          >
            <Upload className="h-4 w-4" />
            <span>Upload</span>
          </ObjectUploader>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search assets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-asset-library-search"
          />
        </div>
        <Select
          value={categoryId}
          onValueChange={(v) => setCategoryId(v)}
        >
          <SelectTrigger className="w-56" data-testid="select-asset-library-category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_CATEGORY}>All categories</SelectItem>
            <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
          <SelectTrigger className="w-36" data-testid="select-asset-library-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="media">Media</SelectItem>
            <SelectItem value="asset">Legacy</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Tag uploads as
          </span>
          <Select
            value={uploadCategoryId ?? NONE_CATEGORY}
            onValueChange={(v) =>
              setUploadCategoryId(v === NONE_CATEGORY ? null : v)
            }
          >
            <SelectTrigger
              className="w-48"
              data-testid="select-asset-library-upload-category"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_CATEGORY}>Uncategorized</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No assets match the current filters.
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {items.map((item) => (
            <AssetCard
              key={`${item.source}:${item.id}`}
              item={item}
              categories={categories}
              categoriesById={categoriesById}
              canEdit={
                item.source === "asset"
                  ? !!access?.isAllowListed
                  : !!access?.isEditorOrAbove
              }
              canDelete={
                item.source === "asset"
                  ? !!access?.isAllowListed
                  : !!access?.isEditorOrAbove
              }
              onCopy={() => {
                const url = absoluteItemUrl(item);
                navigator.clipboard.writeText(url);
                toast({ title: "URL copied" });
              }}
              onDelete={() => handleDelete(item)}
              onSaveAlt={(alt) => handleSaveAlt(item, alt)}
              onChangeCategory={(id) => handleChangeCategory(item, id)}
              onPreview={() => setLightboxItem(item)}
            />
          ))}
        </div>
      )}

      <AssetCategoriesModal open={catsModalOpen} onClose={() => setCatsModalOpen(false)} />

      {/* Lightbox */}
      <Dialog open={!!lightboxItem} onOpenChange={(o) => !o && setLightboxItem(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          {lightboxItem && (() => {
            const isImage = (lightboxItem.mime ?? "").startsWith("image/");
            const fullUrl = itemUrl(lightboxItem);
            const absUrl = absoluteItemUrl(lightboxItem);
            const name = displayName(lightboxItem);
            const cat = lightboxItem.categoryId
              ? categories.find((c) => c.id === lightboxItem.categoryId)
              : lightboxItem.categorySlug
                ? categories.find((c) => c.slug === lightboxItem.categorySlug)
                : null;
            return (
              <>
                {isImage ? (
                  <div className="bg-muted flex items-center justify-center max-h-[60vh] overflow-hidden">
                    <img
                      src={fullUrl}
                      alt={lightboxItem.altText ?? ""}
                      className="max-h-[60vh] max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="bg-muted flex flex-col items-center justify-center gap-3 py-16">
                    <FileText className="h-16 w-16 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">{name}</div>
                  </div>
                )}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate" title={name}>{name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
                        {lightboxItem.mime && <span>{lightboxItem.mime}</span>}
                        {lightboxItem.byteSize != null && (
                          <span>{formatBytes(lightboxItem.byteSize)}</span>
                        )}
                        {lightboxItem.width && lightboxItem.height && (
                          <span>{lightboxItem.width} × {lightboxItem.height}px</span>
                        )}
                        {cat && <span>· {cat.label}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setLightboxItem(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={absUrl}
                      className="h-8 text-xs font-mono"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleCopyLightboxUrl}
                    >
                      {copiedLightbox ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">{copiedLightbox ? "Copied" : "Copy URL"}</span>
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function AssetCard({
  item,
  categories,
  categoriesById,
  canEdit,
  canDelete,
  onCopy,
  onDelete,
  onSaveAlt,
  onChangeCategory,
  onPreview,
}: {
  item: LibraryAssetItem;
  categories: AssetCategory[];
  categoriesById: Map<string, AssetCategory>;
  canEdit: boolean;
  canDelete: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onSaveAlt: (altText: string) => Promise<void>;
  onChangeCategory: (categoryId: string | null) => Promise<void>;
  onPreview: () => void;
}) {
  const thumbUrl = itemUrl(item, { width: 400 });
  const isImage = (item.mime ?? "").startsWith("image/");
  const [alt, setAlt] = useState(item.altText ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const altNeedsReview = isImage && isPlaceholderAlt(alt);

  const currentCategoryId =
    item.categoryId ?? categories.find((c) => c.slug === item.categorySlug)?.id ?? null;

  const handleBlur = async () => {
    if (alt === (item.altText ?? "")) return;
    if (!alt.trim()) {
      setAlt(item.altText ?? "");
      return;
    }
    setState("saving");
    try {
      await onSaveAlt(alt.trim());
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch {
      setState("error");
    }
  };

  return (
    <Card className="overflow-hidden" data-testid={`asset-card-${item.source}-${item.id}`}>
      <div
        className="aspect-square bg-muted overflow-hidden flex items-center justify-center relative group cursor-pointer"
        onClick={onPreview}
      >
        {isImage ? (
          <img
            src={thumbUrl}
            alt={item.altText ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 p-2 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <div className="text-[10px] break-all leading-tight">
              {item.originalName ?? item.storageKey.split("/").pop()}
            </div>
            {item.byteSize != null && (
              <div className="text-[10px]">{formatBytes(item.byteSize)}</div>
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <ZoomIn className="h-6 w-6 text-white drop-shadow" />
        </div>
        <Badge
          variant="outline"
          className="absolute top-1.5 left-1.5 bg-background/90 backdrop-blur text-[9px] px-1 py-0"
        >
          {item.source === "asset" ? "legacy" : "media"}
        </Badge>
        {altNeedsReview && (
          <Badge
            variant="outline"
            className="absolute top-1.5 right-1.5 bg-amber-500/15 border-amber-500/40 text-amber-300 backdrop-blur text-[9px] px-1 py-0"
            title="Alt text is a placeholder. Rewrite it as a meaningful description for screen readers."
          >
            <AlertTriangle className="h-2.5 w-2.5" />
          </Badge>
        )}
      </div>
      <div className="p-1.5 space-y-1">
        <div className="relative">
          <Input
            value={alt}
            onChange={(e) => {
              setAlt(e.target.value);
              if (state === "saved") setState("idle");
            }}
            onBlur={handleBlur}
            placeholder="Alt text"
            className="h-7 text-[11px] pr-6"
            disabled={!canEdit}
            data-testid={`asset-alt-${item.source}-${item.id}`}
          />
          <div
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center"
            data-state={state}
          >
            {state === "saving" && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
            {state === "saved" && <Check className="h-3 w-3 text-green-600" />}
          </div>
        </div>
        <Select
          value={currentCategoryId ?? NONE_CATEGORY}
          onValueChange={(v) =>
            onChangeCategory(v === NONE_CATEGORY ? null : v).catch(() => undefined)
          }
          disabled={!canEdit}
        >
          <SelectTrigger
            className="h-7 text-[11px]"
            data-testid={`asset-category-${item.source}-${item.id}`}
          >
            <SelectValue placeholder="Uncategorized" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_CATEGORY}>Uncategorized</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center justify-between gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={onCopy}
            data-testid={`asset-copy-${item.source}-${item.id}`}
            title="Copy absolute URL"
          >
            <Copy className="h-3 w-3" />
          </Button>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={onDelete}
              data-testid={`asset-delete-${item.source}-${item.id}`}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
        {item.categoryLabel && !categoriesById.has(item.categoryId ?? "") && (
          <div className="text-[9px] text-muted-foreground truncate">
            Tag: {item.categoryLabel}
          </div>
        )}
      </div>
    </Card>
  );
}
