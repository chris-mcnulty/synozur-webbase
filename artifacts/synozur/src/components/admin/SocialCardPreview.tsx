import { Globe } from "lucide-react";
import { mediaUrl } from "@/components/admin/MediaPickerModal";

interface SocialCardPreviewProps {
  title: string;
  description: string;
  imageUrl: string;
  /** Placeholder title used when `title` is empty. Should be the page's real hardcoded default. */
  defaultTitle?: string;
  /** Placeholder description used when `description` is empty. Should be the page's real hardcoded default. */
  defaultDescription?: string;
  /**
   * Default image URL (relative or absolute) shown when `imageUrl` is empty.
   * Should be the page's real hardcoded OG image path, e.g. "/og/og-sprint.jpg".
   */
  defaultImageUrl?: string;
  /** Shown as the source domain strip (defaults to synozur.com). */
  siteDomain?: string;
}

/**
 * Renders a LinkedIn / Slack-style link-unfurl card so admins can see
 * exactly how a page will look when shared on social, before saving.
 *
 * All three fields (title, description, imageUrl) update live as the
 * admin types or picks an image. When a field is empty the card falls
 * back to the real hardcoded default for that page so the preview is
 * always an accurate representation of the effective OG card.
 */
export function SocialCardPreview({
  title,
  description,
  imageUrl,
  defaultTitle = "(no title set)",
  defaultDescription = "(no description set)",
  defaultImageUrl,
  siteDomain = "synozur.com",
}: SocialCardPreviewProps) {
  const effectiveTitle = title.trim() || defaultTitle;
  const effectiveDescription = description.trim() || defaultDescription;

  const resolvedImage: string | null = imageUrl
    ? mediaUrl(imageUrl)
    : (defaultImageUrl ?? null);

  const isPlaceholderTitle = !title.trim();
  const isPlaceholderDesc = !description.trim();
  const isDefaultImage = !imageUrl && !!defaultImageUrl;

  return (
    <div className="space-y-1" data-testid="social-card-preview">
      <div className="w-full max-w-[480px] rounded-md border border-border overflow-hidden bg-card shadow-sm">
        <div className="w-full aspect-[1200/630] bg-muted overflow-hidden">
          {resolvedImage ? (
            <img
              key={resolvedImage}
              src={resolvedImage}
              alt="Social share image preview"
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
              No image selected — social platforms will choose one automatically
            </div>
          )}
        </div>
        <div className="px-3 py-2.5 space-y-0.5 border-t border-border">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="uppercase tracking-wide">{siteDomain}</span>
          </div>
          <p
            className={
              "text-sm font-semibold leading-snug line-clamp-1 " +
              (isPlaceholderTitle ? "text-muted-foreground italic" : "text-foreground")
            }
          >
            {effectiveTitle}
          </p>
          <p
            className={
              "text-xs leading-snug line-clamp-2 " +
              (isPlaceholderDesc ? "text-muted-foreground/70 italic" : "text-muted-foreground")
            }
          >
            {effectiveDescription}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground max-w-[480px]">
        Live preview — updates as you type.
        {(isPlaceholderTitle || isPlaceholderDesc || isDefaultImage) &&
          " Italic text and the image above show the page's hardcoded defaults (used when the field is empty)."}
      </p>
    </div>
  );
}
