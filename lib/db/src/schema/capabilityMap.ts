// #111 — canonical role → capability mapping.
//
// Single source of truth consumed by:
//   - lib/db/src/seed.ts (initial DB hydration)
//   - artifacts/api-server/src/lib/migrations.ts (idempotent reseed
//     so a fresh deploy without `pnpm db:seed` still gets the map)
//   - the /admin/access/capabilities editor uses these values to
//     reset a role to defaults.
//
// Editing this map does NOT automatically update production — the migration
// only inserts ON CONFLICT DO NOTHING so existing rows are preserved. Use
// the admin editor or a follow-up migration to revoke or re-grant.

import { ROLE_NAMES, type RoleName } from "./roles";

export const CAPABILITY_NAMES = [
  "content.view",
  "content.author",
  "content.publish",
  "content.moderate",
  "users.manage",
  "site.manage",
  "oauth.manage",
  "ai.grounding.manage",
  // #225 — manage client organizations and invite client users. Distinct
  // from `users.manage` so account managers can onboard clients without
  // also gaining the ability to mutate site-staff role grants.
  "client_orgs.manage",
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export const CAPABILITY_DESCRIPTIONS: Record<CapabilityName, string> = {
  "content.view": "View admin content (posts, library, taxonomy).",
  "content.author": "Create and edit draft content.",
  "content.publish": "Publish, unpublish, and schedule content.",
  "content.moderate": "Moderate comments and review marketing surfaces.",
  "users.manage": "Manage users, roles, and access mappings.",
  "site.manage": "Manage site-wide settings, redirects, and integrations.",
  "oauth.manage":
    "Register, rotate, and revoke OAuth client apps that authenticate against this site (#128).",
  "ai.grounding.manage":
    "Manage AI grounding documents that ground every AI call across the site.",
  "client_orgs.manage":
    "Manage client organizations, their members, and invitations (#225).",
};

// Default mapping per role. The legacy roles map to exactly what
// lib/capabilities.ts on the client used to compute. The new audience
// classes get conservative defaults — `customer` and `registered` get
// nothing admin-side (they exist for portal authorization, not the CMS).
export const DEFAULT_ROLE_CAPABILITIES: Record<RoleName, readonly CapabilityName[]> = {
  // Legacy roles (preserved as-is for back-compat)
  admin: ["content.view", "content.author", "content.publish", "content.moderate", "users.manage", "site.manage", "oauth.manage", "ai.grounding.manage", "client_orgs.manage"],
  editor: ["content.view", "content.author", "content.publish", "content.moderate", "ai.grounding.manage"],
  author: ["content.view", "content.author"],
  contributor: ["content.view", "content.author"],
  client: [],
  // #110 — audience classes
  site_admin: ["content.view", "content.author", "content.publish", "content.moderate", "users.manage", "site.manage", "oauth.manage", "ai.grounding.manage", "client_orgs.manage"],
  content_author: ["content.view", "content.author", "content.publish", "ai.grounding.manage"],
  hr: ["content.view", "users.manage"],
  internal: ["content.view"],
  customer: [],
  registered: [],
  // #225 — account_manager: client-org admin only.
  account_manager: ["client_orgs.manage"],
};

// Compile-time exhaustiveness check — fails the build if a new role is added
// to ROLE_NAMES without a default capability list.
const _check: Record<(typeof ROLE_NAMES)[number], readonly CapabilityName[]> = DEFAULT_ROLE_CAPABILITIES;
void _check;
