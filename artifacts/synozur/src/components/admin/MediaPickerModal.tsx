import { useEffect, useState } from "react";
import { ObjectUploader } from "@workspace/object-storage-web";
import { Search, Upload, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useListCmsMedia,
  useRegisterCmsMedia,
} from "@workspace/api-client-react";
import type { MediaItem } from "@workspace/api-client-react";
import { api } from "@/lib/api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function mediaUrl(m: { storageKey: string; publicUrl?: string | null }): string {
  if (m.publicUrl) {
    if (m.publicUrl.startsWith("http")) return m.publicUrl;
    return `${BASE_PATH}${m.publicUrl}`;
  }
  if (m.storageKey.startsWith("http")) return m.storageKey;
  return `${BASE_PATH}/api/storage${m.storageKey}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (media: MediaItem) => void;
  selectedId?: string | null;
  title?: string;
}

export function MediaPickerModal({ open, onClose, onSelect, selectedId, title = "Media Library" }: Props) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(selectedId ?? null);

  const { data, isLoading, refetch } = useListCmsMedia(
    { pageSize: 100 },
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

  useEffect(() => {
    if (open) setPicked(selectedId ?? null);
  }, [open, selectedId]);

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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search media…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-media-search"
            />
          </div>
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
                await register.mutateAsync({
                  data: {
                    storageKey,
                    publicUrl,
                    mime: String(f.type ?? "application/octet-stream"),
                    byteSize: Number(f.size ?? 0),
                    altText: String(f.name ?? null),
                  },
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
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No media yet. Upload to get started.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 py-2">
              {items.map((m) => {
                const isPicked = picked === m.id;
                const isImage = (m.mime ?? "").startsWith("image/");
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPicked(m.id)}
                    className={`group relative aspect-square rounded-md overflow-hidden border-2 ${
                      isPicked ? "border-primary" : "border-border"
                    } hover-elevate`}
                    data-testid={`media-item-${m.id}`}
                  >
                    {isImage ? (
                      <img
                        src={mediaUrl(m)}
                        alt={m.altText ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground p-2 break-all">
                        {m.storageKey.split("/").pop()}
                      </div>
                    )}
                    {isPicked && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-media-cancel">
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
  );
}

export async function uploadAndRegisterImage(): Promise<string | null> {
  // Programmatic single-file upload via a hidden file input + API.
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
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) {
          resolve(null);
          return;
        }
        const pathOnly = new URL(uploadURL).pathname;
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
