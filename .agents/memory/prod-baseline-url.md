---
name: Production URL and database
description: Where the Replit-built Synozur app is deployed and how the production DB is managed.
---

**www.synozur.com is now live on the Replit app** — the old Wix site has been cut over.

- `www.synozur.com` / `synozur.com` = this app's production environment.
- "prod" / "the published site" = synozur-baseline.replit.app (Replit deploy domain), which is what www.synozur.com points at.
- Production has its **own separate read-write PostgreSQL database** — it is NOT a periodic content-data copy of development. The user states that the publication process replicates database structures from development to production; use that existing schema-release path rather than proposing separate database provisioning.

**Why:** The user confirmed the DNS cutover is complete and that prod now operates its own live database with real data.
**How to apply:**
- When debugging prod data issues, query the production DB directly (use the `database` skill with `environment: "production"`).
- Never assume prod content or settings rows match dev. Include schema changes in the existing publication process; distinguish structure replication from copying settings or content.
- Do not suggest "re-syncing from dev" — prod DB is now the source of truth for production data.
