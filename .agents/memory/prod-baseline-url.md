---
name: Production baseline URL (pre-launch)
description: Where the Replit-built Synozur app is currently deployed while www is still the old site.
---
While the rebuild is in progress, production for the Replit app is **https://synozur-baseline.replit.app** (autoscale deploy).

- `www.synozur.com` / `synozur.com` is STILL the OLD Wix site — do NOT treat it as this app's prod, and do NOT switch/replace www until the user explicitly says so.
- When the user says "prod" / "the published site" during this phase, they mean synozur-baseline.replit.app.

**Why:** user is running the new app on a baseline domain and cutting over to www only after the rebuild is finished.
**How to apply:** debug/verify production against the baseline URL; never point DNS/www changes at the new app unprompted.
