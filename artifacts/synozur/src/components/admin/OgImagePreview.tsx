import { useEffect, useState } from "react";
import {
  dynamicOgImageUrl,
  type DynamicOgKind,
} from "@/lib/og-image-url";

export type OgImageKind = DynamicOgKind;

interface OgImagePreviewProps {
  kind: OgImageKind;
  id: string | null | undefined;
  updatedAt?: string | Date | null;
  /** Set to true when an OG image override field appears below this preview. */
  showOverrideHint?: boolean;
}

/**
 * Renders a scaled preview of the server-rendered social share image
 * served by `/api/og/image?kind=&id=&v=<updatedAt>`. Cache-busts on the
 * artifact's `updatedAt` so changes show after each save.
 */
export function OgImagePreview({ kind, id, updatedAt, showOverrideHint = false }: OgImagePreviewProps) {
  const src = dynamicOgImageUrl(kind, id, updatedAt ?? null);
  const [errored, setErrored] = useState(false);

  // Reset the error state whenever the source URL changes so a later save
  // can recover from a transient render failure without a page reload.
  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (!id) {
    return (
      <div
        className="w-full max-w-[480px] aspect-[1200/630] rounded-md border border-dashed border-border bg-muted/40 flex items-center justify-center text-xs text-muted-foreground p-4 text-center"
        data-testid="og-preview-empty"
      >
        Save this draft to see a preview of the auto-generated social share
        image.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div
        className="w-full max-w-[480px] aspect-[1200/630] rounded-md border border-border bg-muted overflow-hidden"
        data-testid="og-preview"
      >
        {src && !errored ? (
          <img
            key={src}
            src={src}
            alt="Auto-generated social share preview (1200×630)"
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
            Preview is unavailable. It will appear once the item is saved.
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Auto-generated 1200×630 share image.{" "}
        {showOverrideHint
          ? "Used when no override is set below. "
          : ""}
        Updates after each save.
      </p>
    </div>
  );
}
