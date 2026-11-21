import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetBelongsToPage, canManagePrivatePages, canPreviewPrivatePage,
  canPublishPrivatePage, canReadPrivatePage, parsePrivateAudioRange,
  PRIVATE_RESPONSE_HEADERS, type PrivatePrincipal,
} from "./policy";

const member: PrivatePrincipal = {
  id: "member", kind: "individual", activeOrganizationId: "org-a",
  capabilities: [], disabled: false,
};
const org = { id: "org-a", isActive: true, deletedAt: null };
const page = { organizationId: org.id, status: "published" as const };
const staff = { ...member, activeOrganizationId: null, capabilities: ["client_orgs.manage"] };

test("only the current active organization can read published pages", () => {
  assert.equal(canReadPrivatePage(member, org, page), true);
  assert.equal(canReadPrivatePage(null, org, page), false);
  assert.equal(canReadPrivatePage({ ...member, disabled: true }, org, page), false);
  assert.equal(canReadPrivatePage({ ...member, activeOrganizationId: null }, org, page), false);
  assert.equal(canReadPrivatePage({ ...member, activeOrganizationId: "org-b" }, org, page), false);
  assert.equal(canReadPrivatePage(member, null, page), false);
  assert.equal(canReadPrivatePage(member, { ...org, isActive: false }, page), false);
  assert.equal(canReadPrivatePage(member, { ...org, deletedAt: new Date() }, page), false);
  assert.equal(canReadPrivatePage(member, org, { ...page, organizationId: "org-b" }), false);
  assert.equal(canReadPrivatePage(member, org, { ...page, organizationId: null }), false);
  for (const status of ["draft", "archived"] as const) {
    assert.equal(canReadPrivatePage(member, org, { ...page, status }), false);
    assert.equal(canReadPrivatePage({ ...staff, activeOrganizationId: org.id }, org, { ...page, status }), false);
  }
});

test("staff preview requires a capability and an explicit matching organization", () => {
  for (const status of ["draft", "published", "archived"] as const) {
    assert.equal(canPreviewPrivatePage(staff, org, { ...page, status }, org.id), true);
  }
  assert.equal(canManagePrivatePages(member), false);
  assert.equal(canManagePrivatePages(null), false);
  assert.equal(canManagePrivatePages({ ...staff, disabled: true }), false);
  assert.equal(canPreviewPrivatePage(staff, org, page, null), false);
  assert.equal(canPreviewPrivatePage(staff, org, page, "org-b"), false);
  assert.equal(canPreviewPrivatePage(member, org, page, org.id), false);
  assert.equal(canPreviewPrivatePage(staff, { ...org, isActive: false }, page, org.id), false);
  assert.equal(canPreviewPrivatePage(staff, org, { ...page, organizationId: "org-b" }, org.id), false);
  assert.equal(canPreviewPrivatePage(staff, null, page, org.id), false);
});

test("shared identities cannot inherit staff access even with an erroneous capability grant", () => {
  const shared = { ...staff, kind: "shared" as const, activeOrganizationId: org.id };
  assert.equal(canManagePrivatePages(shared), false);
  assert.equal(canPreviewPrivatePage(shared, org, page, org.id), false);
  assert.equal(canReadPrivatePage(shared, org, page), true);
});

test("asset ownership and kind are independent of knowing an asset identifier", () => {
  const asset = { pageId: "page-a", kind: "audio" as const, state: "ready" };
  assert.equal(assetBelongsToPage("page-a", asset, "audio"), true);
  assert.equal(assetBelongsToPage("page-b", asset, "audio"), false);
  assert.equal(assetBelongsToPage("page-a", asset, "html"), false);
  assert.equal(assetBelongsToPage("page-a", { ...asset, state: "uploading" }, "audio"), false);
  assert.equal(assetBelongsToPage("page-a", null, "audio"), false);
});

test("publication requires current review, completed uploads and every referenced attachment", () => {
  const input = {
    organization: org, pageId: "page-a",
    assets: [{ pageId: "page-a", kind: "html" as const, state: "ready" }],
    requiredKinds: [], uploadsInProgress: false, reviewedRevision: 1, currentRevision: 1,
  };
  assert.equal(canPublishPrivatePage(input), true);
  assert.equal(canPublishPrivatePage({ ...input, organization: null }), false);
  assert.equal(canPublishPrivatePage({ ...input, organization: { ...org, isActive: false } }), false);
  assert.equal(canPublishPrivatePage({ ...input, reviewedRevision: null }), false);
  assert.equal(canPublishPrivatePage({ ...input, currentRevision: 2 }), false);
  assert.equal(canPublishPrivatePage({ ...input, uploadsInProgress: true }), false);
  assert.equal(canPublishPrivatePage({ ...input, assets: [] }), false);
  assert.equal(canPublishPrivatePage({ ...input, requiredKinds: ["audio"] }), false);
  assert.equal(canPublishPrivatePage({
    ...input, requiredKinds: ["audio"],
    assets: [...input.assets, { pageId: "page-b", kind: "audio", state: "ready" }],
  }), false);
  assert.equal(canPublishPrivatePage({
    ...input, requiredKinds: ["audio"],
    assets: [...input.assets, { pageId: "page-a", kind: "audio", state: "ready" }],
  }), true);
});

test("audio byte ranges handle bounded, open-ended, suffix and oversized ends", () => {
  assert.deepEqual(parsePrivateAudioRange(undefined, 100), { kind: "full" });
  assert.deepEqual(parsePrivateAudioRange("bytes=10-19", 100), { kind: "range", start: 10, end: 19, length: 10 });
  assert.deepEqual(parsePrivateAudioRange("bytes=90-", 100), { kind: "range", start: 90, end: 99, length: 10 });
  assert.deepEqual(parsePrivateAudioRange("bytes=-10", 100), { kind: "range", start: 90, end: 99, length: 10 });
  assert.deepEqual(parsePrivateAudioRange("bytes=-200", 100), { kind: "range", start: 0, end: 99, length: 100 });
  assert.deepEqual(parsePrivateAudioRange("bytes=90-200", 100), { kind: "range", start: 90, end: 99, length: 10 });
});

test("invalid and multipart ranges cannot produce inconsistent content lengths", () => {
  for (const header of ["bytes=-", "bytes=-0", "bytes=100-", "bytes=20-10",
    "bytes=0-1,3-4", "items=0-1", "bytes=1.5-2", "bytes=0-9007199254740992",
    "bytes=9007199254740992-", "bytes=+1-2"]) {
    assert.deepEqual(parsePrivateAudioRange(header, 100), { kind: "unsatisfiable" }, header);
  }
  assert.deepEqual(parsePrivateAudioRange("bytes=0-", 0), { kind: "unsatisfiable" });
  assert.deepEqual(parsePrivateAudioRange(undefined, -1), { kind: "unsatisfiable" });
});

test("all confidential response types use no-store, noindex and no-referrer", () => {
  assert.match(PRIVATE_RESPONSE_HEADERS["Cache-Control"], /no-store/);
  assert.match(PRIVATE_RESPONSE_HEADERS["X-Robots-Tag"], /noindex/);
  assert.equal(PRIVATE_RESPONSE_HEADERS["Referrer-Policy"], "no-referrer");
});
