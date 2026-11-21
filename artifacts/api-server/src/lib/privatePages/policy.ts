/**
 * Pure authorization rules for private organization pages.
 *
 * Callers must hydrate these facts from the database on EVERY request. Never
 * substitute JWT role claims, a cached organization, or the portal's staff
 * first-active-organization fallback. A staff preview is a separate operation.
 */
export type PrivatePageStatus = "draft" | "published" | "archived";
export type PrivateAssetKind = "html" | "audio" | "transcript";

export interface PrivatePrincipal {
  id: string;
  kind: "individual" | "shared";
  activeOrganizationId: string | null;
  capabilities: readonly string[];
  disabled: boolean;
}

export interface PrivateOrganization {
  id: string;
  isActive: boolean;
  deletedAt: Date | null;
}

export interface PrivatePageAccess {
  organizationId: string | null;
  status: PrivatePageStatus;
}

export function canManagePrivatePages(user: PrivatePrincipal | null): boolean {
  return !!user && !user.disabled && user.kind === "individual" &&
    user.capabilities.includes("client_orgs.manage");
}

export function canReadPrivatePage(
  user: PrivatePrincipal | null,
  org: PrivateOrganization | null,
  page: PrivatePageAccess,
): boolean {
  return !!user && !user.disabled && !!org && org.isActive &&
    org.deletedAt === null && page.status === "published" &&
    page.organizationId === org.id && user.activeOrganizationId === org.id;
}

export function canPreviewPrivatePage(
  user: PrivatePrincipal | null,
  org: PrivateOrganization | null,
  page: PrivatePageAccess,
  explicitlySelectedOrganizationId: string | null,
): boolean {
  return canManagePrivatePages(user) && !!org && org.isActive &&
    org.deletedAt === null && explicitlySelectedOrganizationId === org.id &&
    page.organizationId === org.id;
}

export function assetBelongsToPage(
  pageId: string,
  asset: { pageId: string; kind: PrivateAssetKind; state: string } | null,
  expectedKind: PrivateAssetKind,
): boolean {
  return !!asset && asset.pageId === pageId &&
    asset.kind === expectedKind && asset.state === "ready";
}

/** HTML is required; optional attachments become required when referenced. */
export function canPublishPrivatePage(input: {
  organization: PrivateOrganization | null;
  pageId: string;
  assets: readonly {
    pageId: string;
    kind: PrivateAssetKind;
    state: string;
  }[];
  requiredKinds: readonly PrivateAssetKind[];
  uploadsInProgress: boolean;
  reviewedRevision: number | null;
  currentRevision: number;
}): boolean {
  const { organization: org } = input;
  if (!org || !org.isActive || org.deletedAt !== null ||
      input.uploadsInProgress ||
      input.reviewedRevision !== input.currentRevision) return false;
  return Array.from(new Set<PrivateAssetKind>(["html", ...input.requiredKinds]))
    .every((kind) =>
      input.assets.some((asset) => assetBelongsToPage(input.pageId, asset, kind)));
}

export const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export type ByteRange =
  | { kind: "full" }
  | { kind: "range"; start: number; end: number; length: number }
  | { kind: "unsatisfiable" };

/** Single byte ranges only; reject malformed/multipart requests, never guess. */
export function parsePrivateAudioRange(header: string | undefined, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size < 0) return { kind: "unsatisfiable" };
  if (header === undefined) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return { kind: "unsatisfiable" };
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) ||
        start >= size || requestedEnd < start) return { kind: "unsatisfiable" };
    end = Math.min(requestedEnd, size - 1);
  }
  return { kind: "range", start, end, length: end - start + 1 };
}
