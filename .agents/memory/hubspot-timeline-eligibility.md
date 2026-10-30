---
name: HubSpot timeline eligibility
description: Verify legacy app eligibility and app-bound authentication before configuring timeline events.
---

Do not treat a numeric HubSpot App ID as sufficient to enable timeline delivery,
or choose a sister application's ID based on its name.

**Why:** HubSpot's current legacy timeline documentation restricts v1/v3 use to
app partners with existing timeline event types in their public app. Template
management uses developer authentication; event delivery uses OAuth for the
associated app. The generic HubSpot connector is not automatically authorization
for a user-owned legacy app.

**How to apply:** Inspect existing app event types, confirm eligibility and
OAuth ownership, and verify the current API/authentication contract before
changing settings or replaying queued events. Do not ask for developer keys in
chat. Preserve the desired behavioral signals if another integration path is
needed; do not silently substitute weaker contact-only synchronization.

Reference: https://developers.hubspot.com/docs/api-reference/legacy/crm/extensions/timeline/guide.md

Synozur Orbit is the user's marketing-content and market-research app, distinct
from the Synozur public website.

**Why:** The user clarified Orbit's purpose while reviewing the legacy HubSpot
apps.

**How to apply:** Do not assume Orbit's HubSpot App ID or authorization belongs
in the public website's settings merely because both carry Synozur branding.
