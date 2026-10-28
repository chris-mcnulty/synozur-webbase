---
name: Entra access provisioning
description: Security and role ownership decisions for preparing website access before first Microsoft sign-in.
---

Preassigned editorial website access must bind to the internal tenant and immutable user Object ID, not an email-only placeholder. This prepares access for an existing Microsoft account; it does not create a tenant account or send an invitation.

**Why:** The user wants administrators to grant editor/author access before the user's first visit. An email match alone is not a sufficient identity boundary for preassigned privileges in this multi-tenant sign-in flow.

**How to apply:** Prefer directory lookup using the work sign-in address, with explicit administrator-supplied Object ID when directory read permission is unavailable. A verified sign-in from another tenant/object must not claim prepared access, even with the same email.

Explicit administrator role assignments are independent of Entra group-managed grants.

**Why:** Group reconciliation previously treated every instance of a mapped role as group-owned, which could silently remove an administrator's deliberate assignment at sign-in.

**How to apply:** Preserve explicitly assigned grants during group refresh. Do not retroactively mark all legacy or automatic grants as manual. Explain that group-managed grants can return while the user remains in their mapped group.
