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
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { AssetCategoriesModal } from "@/components/admin/AssetCategoriesModal";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/asset-kind";
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
const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function itemUrl(item: LibraryAssetItem): string {
  if (item.publicUrl) {
    if (item.publicUrl.startsWith("http")) return item.publicUrl;
    return `${BASE_PATH}${item.publicUrl}`;
  }
  if (item.storageKey.startsWith("http")) return item.storageKey;
  return `${BASE_PATH}/api/storage${item.storageKey}`;
}

function displayName(item: LibraryAssetItem): string {
  return (
    item.originalName ??
    item.altText ??
    item.storageKey.split("/").pop() ??
    "(unnamed)"
  );
}

// #142 Phase A — Detect placeholder alt text that came from the upload
// fallback or the backfill script. Editors should rewrite these into real
// descriptive copy before a published image relies on them for a11y.
function isPlaceholderAlt(altText: string | null | undefined): boolean {
  if (!altText) return true;
  return /^Image:\s/.test(altText.trim());
}

export default function AssetsLibrary() {
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | "__any__">(ANY_CATEGORY);
  const [source, setSource] = useState<"all" | "asset" | "media">("all");
  const [catsModalOpen, setCatsModalOpen] = useState(false);
  const [uploadCategoryId, setUploadCategoryId] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListLibraryAssetsQueryKey() });

  const { data: cats } = useListAssetCategories();
  const categories: AssetCategory[] = cats?.items ?? [];

  const { data, isLoading } = useListLibraryAssets({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(categoryId !== ANY_CATEGORY ? { categoryId } : {}),
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
    if (!confirm(`Delete "${displayName(item)}"?`)) return;
    if (item.source === "media") {
      deleteMedia.mutate({ id: item.id });
    } else {
      deleteAsset.mutate({ id: Number(item.id) });
    }
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
                // #142 Phase A — altText is required and non-empty. Use a
                // deterministic placeholder shape so the asset library can
                // flag rows that still need editorial review.
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
              onCopy={(url) => {
                navigator.clipboard.writeText(url);
                toast({ title: "URL copied" });
              }}
              onDelete={() => handleDelete(item)}
              onSaveAlt={(alt) => handleSaveAlt(item, alt)}
              onChangeCategory={(id) => handleChangeCategory(item, id)}
            />
          ))}
        </div>
      )}

      <AssetCategoriesModal open={catsModalOpen} onClose={() => setCatsModalOpen(false)} />
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
}: {
  item: LibraryAssetItem;
  categories: AssetCategory[];
  categoriesById: Map<string, AssetCategory>;
  canEdit: boolean;
  canDelete: boolean;
  onCopy: (url: string) => void;
  onDelete: () => void;
  onSaveAlt: (altText: string) => Promise<void>;
  onChangeCategory: (categoryId: string | null) => Promise<void>;
}) {
  const url = itemUrl(item);
  const isImage = (item.mime ?? "").startsWith("image/");
  const [alt, setAlt] = useState(item.altText ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const altNeedsReview = isImage && isPlaceholderAlt(alt);

  const currentCategoryId =
    item.categoryId ?? categories.find((c) => c.slug === item.categorySlug)?.id ?? null;

  const handleBlur = async () => {
    if (alt === (item.altText ?? "")) return;
    // #142 Phase A — alt text is required and non-empty. Revert to the
    // existing value rather than firing a request the server will reject.
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
      <div className="aspect-square bg-muted overflow-hidden flex items-center justify-center relative">
        {isImage ? (
          <img
            src={url}
            alt={item.altText ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground">
            <FileText className="h-10 w-10" />
            <div className="text-xs break-all">
              {item.originalName ?? item.storageKey.split("/").pop()}
            </div>
            {item.byteSize != null && (
              <div className="text-[11px]">{formatBytes(item.byteSize)}</div>
            )}
          </div>
        )}
        <Badge
          variant="outline"
          className="absolute top-2 left-2 bg-background/90 backdrop-blur text-[10px]"
        >
          {item.source === "asset" ? "legacy" : "media"}
        </Badge>
        {altNeedsReview && (
          <Badge
            variant="outline"
            className="absolute top-2 right-2 bg-amber-500/15 border-amber-500/40 text-amber-300 backdrop-blur text-[10px] gap-1"
            title="Alt text is a placeholder. Rewrite it as a meaningful description for screen readers."
          >
            <AlertTriangle className="h-3 w-3" />
            Needs alt text
          </Badge>
        )}
      </div>
      <div className="p-2 space-y-1.5">
        <div className="relative">
          <Input
            value={alt}
            onChange={(e) => {
              setAlt(e.target.value);
              if (state === "saved") setState("idle");
            }}
            onBlur={handleBlur}
            placeholder="Alt text"
            className="h-8 text-xs pr-7"
            disabled={!canEdit}
            data-testid={`asset-alt-${item.source}-${item.id}`}
          />
          <div
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
            data-state={state}
          >
            {state === "saving" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            {state === "saved" && <Check className="h-3.5 w-3.5 text-green-600" />}
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
            className="h-8 text-xs"
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
        <div className="flex items-center justify-between gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCopy(url)}
            data-testid={`asset-copy-${item.source}-${item.id}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              data-testid={`asset-delete-${item.source}-${item.id}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
        {/* Preserve category label hint for a11y */}
        {item.categoryLabel && !categoriesById.has(item.categoryId ?? "") && (
          <div className="text-[10px] text-muted-foreground truncate">
            Tag: {item.categoryLabel}
          </div>
        )}
      </div>
    </Card>
  );
}
