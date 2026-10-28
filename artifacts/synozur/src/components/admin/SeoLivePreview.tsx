/**
 * SeoLivePreview — client-side live preview of how a page will appear in
 * Google search results and social link unfurls.
 *
 * Unlike OgImagePreview (which shows the server-rendered 1200×630 card and
 * only updates after saving), this component derives everything from the
 * current form values so admins can validate their SEO copy without saving.
 */

import { Globe } from "lucide-react";

interface SeoLivePreviewProps {
  /** Effective page title: use seoTitle when set, otherwise fall back to title. */
  title: string;
  /** Effective meta description: use seoDescription when set, otherwise fall back to summary. */
  description: string;
  /**
   * URL slug shown in the Google snippet (just the path segment, e.g.
   * "ep-42-ai-strategy"). The component prepends "synozur.com › polaris".
   */
  slug: string;
  /**
   * Thumbnail shown in the social card.  Can be any preview URL (artworkUrl,
   * ogImage, etc.).  When falsy, a placeholder is rendered.
   */
  imageUrl?: string | null;
}

/** Truncate at a word boundary to avoid mid-word cuts. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, max)) + "…";
}

export function SeoLivePreview({ title, description, slug, imageUrl }: SeoLivePreviewProps) {
  const effectiveTitle = title.trim() || "Untitled episode";
  const effectiveDesc = description.trim() || "";
  const effectiveSlug = slug.trim();

  return (
    <div className="space-y-4">
      {/* ── Google snippet ─────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Google snippet</p>
        <div className="rounded-lg border border-border bg-background p-3 max-w-[480px] space-y-0.5 font-sans">
          {/* breadcrumb */}
          <div className="flex items-center gap-1 text-[11px] text-green-700 dark:text-green-500 truncate">
            <Globe className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              synozur.com{effectiveSlug ? ` › polaris › ${effectiveSlug}` : " › polaris"}
            </span>
          </div>
          {/* title */}
          <p className="text-[15px] leading-snug text-blue-700 dark:text-blue-400 font-medium line-clamp-2">
            {truncate(effectiveTitle, 60)}
          </p>
          {/* description */}
          {effectiveDesc ? (
            <p className="text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
              {truncate(effectiveDesc, 160)}
            </p>
          ) : (
            <p className="text-[12px] leading-relaxed text-muted-foreground/50 italic">
              No meta description — Google will auto-generate a snippet.
            </p>
          )}
        </div>
      </div>

      {/* ── Social card (LinkedIn / Teams / Slack style) ─────────────── */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Social card preview</p>
        <div className="rounded-lg border border-border bg-background overflow-hidden max-w-[480px]">
          {/* image strip */}
          <div className="aspect-[1200/630] bg-muted flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Social preview"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs text-muted-foreground/60 px-4 text-center">
                No image — artwork or OG image will appear here once set
              </span>
            )}
          </div>
          {/* text area */}
          <div className="px-3 py-2 border-t border-border space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              synozur.com
            </p>
            <p className="text-sm font-medium leading-snug line-clamp-2">
              {truncate(effectiveTitle, 70)}
            </p>
            {effectiveDesc && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {truncate(effectiveDesc, 140)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
