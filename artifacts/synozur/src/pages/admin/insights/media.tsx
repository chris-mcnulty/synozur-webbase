import { useState } from "react";
import { ObjectUploader } from "@workspace/object-storage-web";
import { Search, Upload, Trash2, Copy, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  useListCmsMedia,
  useRegisterCmsMedia,
  useDeleteCmsMedia,
  useUpdateCmsMedia,
  type MediaItem,
} from "@workspace/api-client-react";
import { mediaUrl } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

export default function MediaLibrary() {
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const [search, setSearch] = useState("");
  const { data, isLoading, refetch } = useListCmsMedia({ pageSize: 200 });

  const register = useRegisterCmsMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Upload registered" });
        refetch();
      },
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    },
  });

  const update = useUpdateCmsMedia({
    mutation: {
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });

  const del = useDeleteCmsMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Deleted" });
        refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const items = (data?.items ?? []).filter((m) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (m.altText ?? "").toLowerCase().includes(s) ||
      (m.publicUrl ?? "").toLowerCase().includes(s) ||
      m.storageKey.toLowerCase().includes(s)
    );
  });

  return (
    <AdminLayout
      title="Media Library"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Media" }]}
      actions={
        <ObjectUploader
          maxNumberOfFiles={10}
          maxFileSize={10 * 1024 * 1024}
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
            for (const f of (result.successful ?? []) as unknown as Array<Record<string, unknown>>) {
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
              // #142 Phase A — altText is required and non-empty.
              const fileName = String(f.name ?? "");
              const altBase = fileName.replace(/\.[^./\\]+$/, "").trim();
              await register.mutateAsync({
                data: {
                  storageKey,
                  publicUrl,
                  mime: String(f.type ?? "application/octet-stream"),
                  byteSize: Number(f.size ?? 0),
                  altText: altBase ? `Image: ${altBase}` : "Image: untitled",
                  originalName: fileName || undefined,
                },
              });
            }
          }}
        >
          <Upload className="h-4 w-4" />
          <span>Upload</span>
        </ObjectUploader>
      }
    >
      <div className="relative max-w-md mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search media…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-media-page-search"
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No media uploaded yet.
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((m) => (
            <MediaCard
              key={m.id}
              item={m}
              canDelete={!!access?.isEditorOrAbove}
              onCopy={(url) => {
                navigator.clipboard.writeText(url);
                toast({ title: "URL copied" });
              }}
              onDelete={() => {
                if (confirm("Delete this media?")) del.mutate({ id: m.id });
              }}
              onSaveAlt={async (altText) => {
                await update.mutateAsync({ id: m.id, data: { altText } });
                refetch();
              }}
            />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function MediaCard({
  item,
  canDelete,
  onCopy,
  onDelete,
  onSaveAlt,
}: {
  item: MediaItem;
  canDelete: boolean;
  onCopy: (url: string) => void;
  onDelete: () => void;
  onSaveAlt: (altText: string) => Promise<void>;
}) {
  const url = mediaUrl(item);
  const isImage = (item.mime ?? "").startsWith("image/");
  const [alt, setAlt] = useState(item.altText ?? "");
  const [state, setState] = useState<SaveState>("idle");

  const handleBlur = async () => {
    const trimmed = alt;
    if (trimmed === (item.altText ?? "")) return;
    setState("saving");
    try {
      await onSaveAlt(trimmed);
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch {
      setState("error");
    }
  };

  return (
    <Card className="overflow-hidden" data-testid={`media-card-${item.id}`}>
      <div className="aspect-square bg-muted overflow-hidden flex items-center justify-center">
        {isImage ? (
          <img src={url} alt={item.altText ?? ""} className="h-full w-full object-cover" />
        ) : (
          <div className="text-xs text-muted-foreground p-2 break-all">
            {item.storageKey.split("/").pop()}
          </div>
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
            data-testid={`alt-input-${item.id}`}
          />
          <div
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
            data-testid={`alt-status-${item.id}`}
            data-state={state}
          >
            {state === "saving" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            {state === "saved" && <Check className="h-3.5 w-3.5 text-green-600" />}
          </div>
        </div>
        <div className="flex items-center justify-between gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCopy(url)}
            data-testid={`copy-url-${item.id}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              data-testid={`delete-media-${item.id}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
