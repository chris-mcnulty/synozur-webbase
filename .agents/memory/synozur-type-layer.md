---
name: synozur hand-written API type layer
description: synozur app defines its own request/response types separate from generated api-client-react; OpenAPI edits alone won't fix synozur typecheck.
---

`artifacts/synozur/src/lib/api.ts` hand-writes its own `PublicSiteSettings`,
`AdminSiteSettings`, `UpdateSiteSettingsBody` (and peer types) plus a bespoke
`api` fetch client. It does NOT consume the generated
`@workspace/api-client-react` schema types for these.

**Why:** synozur predates / opts out of the generated client for site-settings,
so the generated types and synozur's `api.ts` types are two independent sources
of truth that must be kept in sync by hand.

**How to apply:** When you add a field to an OpenAPI schema that synozur reads
or writes (e.g. site-settings), running codegen updates
`@workspace/api-client-react` and `lib/api-zod`, but synozur will still fail to
typecheck with "Property X does not exist on type PublicSiteSettings" until you
ALSO add the field to the matching interface(s) in
`artifacts/synozur/src/lib/api.ts`. Other artifacts (e.g. galaxy) may consume
the generated client directly — check per artifact.
