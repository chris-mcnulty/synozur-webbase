import { db, seoUnpublishSubmissionsTable } from "@workspace/db";
import { submitUrls, type SubmitBundle } from "./seoSubmit";
import { siteOrigin } from "./siteOrigin";
import { logger } from "./logger";

// #254 — Submit a "gone" URL to every configured search-engine channel
// when a piece of content transitions from publicly reachable to gone
// (status='archived', past unpublishedAt, or active=false). Records the
// per-channel result so /admin/site-config/launch-readiness can surface
// the most recent attempt per channel.
//
// Best-effort: every step swallows its own errors so a broken submission
// channel can never break the underlying CMS save.

export interface UnpublishableState {
  status?: string | null;
  unpublishedAt?: Date | null | string;
  active?: boolean | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Mirror of {@link import("./goneResponse").isGone}. By default only
 * `status='archived'` and a past `unpublishedAt` count as gone. The
 * `treatInactiveAsGone` flag is opt-in for entity types whose public
 * loader returns 410 for `active=false` (currently workshops); for
 * everything else `active=false` typically means 404, which is not a
 * URL-removal signal worth pinging the search engines about.
 */
export function isGoneState(
  row: UnpublishableState,
  opts: { now?: Date; treatInactiveAsGone?: boolean } = {},
): boolean {
  const now = opts.now ?? new Date();
  if (row.status === "archived") return true;
  const u = toDate(row.unpublishedAt ?? null);
  if (u && u <= now) return true;
  if (opts.treatInactiveAsGone && row.active === false) return true;
  return false;
}

export interface UnpublishSubmitArgs {
  entityType: string;
  entityId: string;
  slug: string;
  /** Public path, e.g. `/insights/my-post`. Origin is appended automatically. */
  publicPath: string;
  before: UnpublishableState;
  after: UnpublishableState;
  /**
   * Optional second public path to also submit. Use when an admin save
   * changes the slug at the same moment it transitions the row to gone:
   * the previously-indexed (pre-transition) URL must be the primary
   * submission, and the new URL can be submitted too in case it leaked.
   */
  alsoSubmitPath?: string;
  /**
   * Set to true for entity types whose public loader returns 410 for
   * `active=false` (currently only workshops). Without this flag, an
   * `active=false` flip is treated as a soft-delete (404), not a gone
   * URL, and the helper no-ops.
   */
  treatInactiveAsGone?: boolean;
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
}

/**
 * If the row transitioned from "live" → "gone" between `before` and `after`,
 * submit its public URL to every configured search-engine channel and log
 * the per-channel result. Returns the bundle when a submission ran, or
 * null when no transition was detected.
 */
export async function submitIfTransitionedToGone(
  args: UnpublishSubmitArgs,
): Promise<SubmitBundle | null> {
  try {
    const treatInactiveAsGone = args.treatInactiveAsGone ?? false;
    const wasGone = isGoneState(args.before, { treatInactiveAsGone });
    const nowGone = isGoneState(args.after, { treatInactiveAsGone });
    if (wasGone || !nowGone) return null;

    const origin = siteOrigin();
    const normalize = (p: string) => (p.startsWith("/") ? p : `/${p}`);
    const path = normalize(args.publicPath);
    const url = `${origin}${path}`;
    // #254: if the slug changed in the same save that flipped the row to
    // gone, both URLs may be in indexes (the old, indexed URL and the new
    // one if it leaked). Submit both so search engines drop everything.
    const urls = [url];
    if (args.alsoSubmitPath) {
      const altUrl = `${origin}${normalize(args.alsoSubmitPath)}`;
      if (altUrl !== url) urls.push(altUrl);
    }

    // #254: explicitly request "delete" semantics so the Google Indexing
    // API receives URL_DELETED (not URL_UPDATED). IndexNow and Bing batch
    // submission have no delete mode — the engines refetch, see 410, and
    // de-index — but Google requires the explicit removal notification.
    const bundle = await submitUrls(origin, urls, { mode: "delete" });

    // Persist per-channel results so the admin readout has truthful data
    // even when individual channels are unconfigured (those rows record the
    // skip reason in `error`). When multiple URLs were submitted we record
    // the primary (pre-transition) URL for the audit row.
    const rows = bundle.results.map((r) => ({
      entityType: args.entityType,
      entityId: args.entityId,
      slug: args.slug,
      url,
      channel: r.target,
      ok: r.ok,
      httpStatus: r.status ?? null,
      submitted: r.submitted,
      error: r.error ?? null,
    }));
    if (rows.length > 0) {
      try {
        await db.insert(seoUnpublishSubmissionsTable).values(rows);
      } catch (err) {
        const log = args.log ?? logger;
        log.error({ err, entityType: args.entityType, entityId: args.entityId },
          "Failed to persist seo unpublish submission results");
      }
    }

    return bundle;
  } catch (err) {
    const log = args.log ?? logger;
    log.error({ err, entityType: args.entityType, entityId: args.entityId },
      "submitIfTransitionedToGone failed");
    return null;
  }
}
