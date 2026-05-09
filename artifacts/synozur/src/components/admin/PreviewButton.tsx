import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  type EntityKind,
  publicPathFor,
  getEntityRegistration,
} from "@/lib/entity-registry";

interface PreviewButtonProps {
  kind: EntityKind;
  /** Saved entity id. Required to mint preview tokens. */
  id?: string | null;
  /** Saved entity slug. Required to build the public URL. */
  slug?: string | null;
  /**
   * When true, the entity is not yet visible to anonymous traffic and
   * needs a preview token (or — for kinds without token support — will
   * 404 with a warning toast). When false / undefined, the public URL
   * works for everyone.
   */
  isDraft?: boolean;
}

/**
 * Header button on every admin edit page that opens the matching public
 * detail page in a new tab — the round-trip "did my edit look right?"
 * shortcut. For services and solutions, draft items get a 24h signed
 * preview token so unpublished content renders correctly. For other
 * kinds, draft preview is not yet supported (#142 follow-up); the
 * button still works for published items, and we toast a hint for
 * drafts.
 *
 * Disabled while there is no slug yet (new-item form before first save).
 */
export function PreviewButton({ kind, id, slug, isDraft }: PreviewButtonProps) {
  const reg = getEntityRegistration(kind);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const disabled = !slug || busy;

  async function open() {
    if (!slug) return;

    // Published items: just open the public URL.
    if (!isDraft) {
      window.open(publicPathFor(kind, slug), "_blank", "noopener");
      return;
    }

    // Draft items with token support: mint, then open `previewPath`.
    if (reg.supportsPreviewToken && id) {
      try {
        setBusy(true);
        const result =
          kind === "service"
            ? await api.createServicePreviewToken(String(id))
            : kind === "solution"
              ? await api.createSolutionPreviewToken(String(id))
              : null;
        if (result?.previewPath) {
          window.open(result.previewPath, "_blank", "noopener");
        } else {
          toast({
            title: "Preview unavailable",
            description: "Could not mint a preview token for this draft.",
            variant: "destructive",
          });
        }
      } catch (err) {
        toast({
          title: "Preview failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    // Draft items without token support: open the public URL anyway.
    // The public route will 404 — surface a hint so the editor knows
    // to publish (or use the in-admin preview where one exists) rather
    // than wonder why nothing showed up.
    toast({
      title: "Draft not previewable",
      description:
        "This item isn't published yet, so the public URL will 404. Publish it (or use the in-admin preview) to see it live.",
    });
    window.open(publicPathFor(kind, slug), "_blank", "noopener");
  }

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={open}
      disabled={disabled}
      data-testid="preview-button"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
      ) : (
        <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
      )}
      Preview
    </Button>
  );

  if (!disabled) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        {!slug
          ? "Save the item first to enable preview."
          : "Working…"}
      </TooltipContent>
    </Tooltip>
  );
}
