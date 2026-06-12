// EditWedge — the "edit this page without leaving the live site" gate.
//
// Each public detail page mounts <EditWedge ... /> with the entity it
// renders. For signed-in users with the right capability, a small
// floating chip appears bottom-right; clicking it opens a metadata-edit
// modal that patches the entity in place. For everyone else, the wedge
// renders nothing — anonymous visitors never see it.
//
// This module is intentionally light: it imports `useAdminAccess` and
// the entity registry, decides whether to render, and lazy-loads the
// real body (`edit-wedge-body.tsx`) only for users that pass the
// capability check. Anonymous traffic doesn't pay for the dialog,
// MediaPickerModal (Uppy), or the rest of the admin UI surface.
//
// ---------------------------------------------------------------------
// Where to mount this:
//
//   ✓ DO mount on a public detail page that's bound to a single
//     editable CMS row registered in `entity-registry.ts` — e.g.
//     /insights/:slug, /services/:slug, /case-studies/:slug. The
//     wedge expects to PATCH one entity by id and to render against
//     a snapshot of that entity.
//
//   ✗ DO NOT mount on:
//     - error pages (`not-found.tsx`, `gone.tsx`),
//     - search-results page (`search.tsx`) — no single entity,
//     - list / index pages (`/insights`, `/case-studies`, `/team`,
//       `/library`, etc.) — those have multiple entities; use the
//       `content_parent_pages` admin or a future static-pages model
//       (see BACKLOG.md §1a) to edit hero / intro copy instead,
//     - the root home page or its A/B variants
//       (`home.tsx` / `home-b.tsx`) — the home page composes from
//       site_settings, publish_blocks, experiments, and featured
//       collateral, so there's no single entity to PATCH. Mount
//       `<HomeConfigWedge>` from `home-config-wedge.tsx` instead;
//       that is a navigation-only chip that links to the relevant
//       admin pages,
//     - hand-coded marketing pages (`/about`, `/contact`,
//       `/partners`, `/clients`, `/privacy`, `/terms`) — no DB row
//       to patch yet,
//     - form / booking flows (`/start`, `/contact`, `/careers/jobs/:slug/apply`),
//     - auth surfaces (`/sign-in`, `/sign-up`, `/verify-email`,
//       `/forgot-password`, etc.),
//     - the AI Q&A page (`/insights/ask`).
//
// If you're tempted to mount the wedge somewhere not in the list
// above, double-check that there's a single, registered entity kind
// with a stable id and a partial-patch CMS endpoint backing it.
// Otherwise add a navigation-only chip (modeled after
// `home-config-wedge.tsx`) instead.
// ---------------------------------------------------------------------
import { lazy, Suspense } from "react";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { type EntityKind, getEntityRegistration } from "@/lib/entity-registry";

/**
 * Snapshot of the entity as the public page already loaded it. The wedge
 * reads a few well-known fields if present and quietly ignores the rest;
 * fields the public payload doesn't expose just render as empty.
 *
 * Permissive `[key: string]: unknown` so detail pages can spread their
 * full DTOs in without TS arguing about extra properties.
 */
export type EntitySnapshot = {
  id?: string | number | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  // Status surfaces vary across entities — accept any of these.
  status?: string | null;
  active?: boolean | null;
  publishedAt?: string | null;
  // Image fields. Public payload may carry id, URL, or both.
  heroImageId?: string | null;
  heroImage?: string | null;
  heroImageUrl?: string | null;
  ogImageId?: string | null;
  ogImage?: string | null;
  ogImageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
} & { [key: string]: unknown };

interface EditWedgeProps {
  kind: EntityKind;
  id: string | number | null | undefined;
  slug: string | null | undefined;
  /**
   * Current entity payload from the page's own React Query call.
   * Permissive `unknown` so detail pages can pass their typed DTOs
   * without juggling type casts; the wedge reads the well-known
   * fields it cares about and ignores the rest.
   */
  snapshot: unknown;
  /**
   * Optional. The React Query key the public page uses to fetch this entity.
   * When provided, the wedge invalidates it after a successful save so the
   * page re-renders with new content. When absent, the wedge invalidates
   * everything (broad but safe).
   */
  queryKey?: readonly unknown[];
  /**
   * Optional. Called after a successful save. Pages that fetch via
   * `useEffect` rather than React Query (currently library-detail and
   * webinar-detail) need this to re-run their loader so the live page
   * reflects the change without a full reload.
   */
  onSaved?: () => void;
}

function asSnapshot(v: unknown): EntitySnapshot {
  if (v && typeof v === "object") return v as EntitySnapshot;
  return {};
}

// Lazy import so anonymous traffic doesn't download the dialog +
// MediaPickerModal (Uppy) + form widgets that live in the body.
const EditWedgeBody = lazy(() => import("./edit-wedge-body"));

export function EditWedge({ kind, id, slug, snapshot, queryKey, onSaved }: EditWedgeProps) {
  const { access, signedIn } = useAdminAccess();

  if (!signedIn || !access) return null;
  if (!id || !slug) return null;
  const reg = getEntityRegistration(kind);
  if (!reg.capabilities.some((cap) => access.hasCapability(cap))) return null;

  return (
    <Suspense fallback={null}>
      <EditWedgeBody
        kind={kind}
        id={id}
        slug={slug}
        snapshot={asSnapshot(snapshot)}
        queryKey={queryKey}
        onSaved={onSaved}
      />
    </Suspense>
  );
}
