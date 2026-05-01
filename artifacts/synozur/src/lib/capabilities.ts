// Client-side capability map.
//
// Until #111 the SPA recomputed capabilities from a hard-coded role→
// capability map. The server now hydrates `effectiveCapabilities` on
// `/api/auth/me`, so this module is a fallback only — used when the
// server response is missing the field (older deploys, or the legacy
// `isAllowListed` allow-list path that grants `site.manage` outside
// the role system).

export const CAPABILITIES = [
  "content.view",
  "content.author",
  "content.publish",
  "content.moderate",
  "users.manage",
  "site.manage",
  "ai.grounding.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  admin: ["content.view", "content.author", "content.publish", "content.moderate", "users.manage", "site.manage", "ai.grounding.manage"],
  editor: ["content.view", "content.author", "content.publish", "content.moderate", "ai.grounding.manage"],
  author: ["content.view", "content.author"],
  contributor: ["content.view", "content.author"],
  // #110 — audience classes
  site_admin: ["content.view", "content.author", "content.publish", "content.moderate", "users.manage", "site.manage", "ai.grounding.manage"],
  content_author: ["content.view", "content.author", "content.publish", "ai.grounding.manage"],
  hr: ["content.view", "users.manage"],
  internal: ["content.view"],
};

export function computeCapabilities(
  roles: readonly string[],
  allowListed: boolean,
): Set<Capability> {
  const caps = new Set<Capability>();
  for (const role of roles) {
    const granted = ROLE_CAPABILITIES[role];
    if (!granted) continue;
    for (const cap of granted) caps.add(cap);
  }
  if (allowListed) caps.add("site.manage");
  return caps;
}

// Used when the server hands us a hydrated capability list.
export function capabilitiesFromServer(
  effective: readonly string[],
  allowListed: boolean,
): Set<Capability> {
  const caps = new Set<Capability>();
  for (const c of effective) {
    if ((CAPABILITIES as readonly string[]).includes(c)) {
      caps.add(c as Capability);
    }
  }
  if (allowListed) caps.add("site.manage");
  return caps;
}
