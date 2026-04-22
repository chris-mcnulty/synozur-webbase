import { useQuery } from "@tanstack/react-query";
import { api, type ContentParentPageDto } from "@/lib/api";
import { sanitizeHtml } from "@/components/rich-text";

/**
 * #97: resolved hero + intro copy for a resource list page.
 *
 * Each field is a plain string — callers pass their hardcoded default and
 * get back either the DB override (when the row exists and the field is a
 * non-empty string) or the default. When the DB row is missing, all
 * defaults pass through unchanged.
 */
export interface ParentPageCopy {
  heroEyebrow: string;
  heroHeadline: string;
  heroSubhead: string;
  introHtml: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string | undefined;
}

export interface ParentPageDefaults {
  heroEyebrow?: string;
  heroHeadline?: string;
  heroSubhead?: string;
  introHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
}

function pick(override: string | null | undefined, fallback: string | undefined): string {
  if (override && override.trim().length > 0) return override;
  return fallback ?? "";
}

export function resolveParentPageCopy(
  row: ContentParentPageDto | null,
  defaults: ParentPageDefaults,
): ParentPageCopy {
  return {
    heroEyebrow: pick(row?.heroEyebrow ?? null, defaults.heroEyebrow),
    heroHeadline: pick(row?.heroHeadline ?? null, defaults.heroHeadline),
    heroSubhead: pick(row?.heroSubhead ?? null, defaults.heroSubhead),
    introHtml: sanitizeHtml(pick(row?.introHtml ?? null, defaults.introHtml)),
    seoTitle: pick(row?.seoTitle ?? null, defaults.seoTitle),
    seoDescription: pick(row?.seoDescription ?? null, defaults.seoDescription),
    ogImage:
      (row?.ogImage && row.ogImage.trim().length > 0 && row.ogImage) ||
      defaults.ogImage ||
      undefined,
  };
}

/**
 * Fetch the parent-page row for `slug` and resolve it against the caller's
 * hardcoded defaults. A 404 (no DB row yet) is treated as "use defaults";
 * any other error is swallowed for the same reason — parent-page copy is
 * never a blocker for rendering the list.
 */
export function useParentPage(
  slug: string,
  defaults: ParentPageDefaults,
): ParentPageCopy {
  const { data } = useQuery({
    queryKey: ["parent-page", slug],
    queryFn: async () => {
      try {
        return await api.getParentPage(slug);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
  return resolveParentPageCopy(data ?? null, defaults);
}
