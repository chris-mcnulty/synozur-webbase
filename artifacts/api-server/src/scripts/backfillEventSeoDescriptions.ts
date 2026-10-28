// One-shot CLI wrapper for the event SEO-description backfill.
//
//   pnpm --filter @workspace/api-server backfill:event-seo-descriptions
//
// Targets whatever DATABASE_URL points at. The same backfill also runs
// automatically at server startup (idempotent — only fills blank
// seo_description values, never overwrites admin edits), so this script is
// mainly useful for manual/dry verification.
import { seedEventSeoDescriptionsIfMissing } from "../lib/eventSeoDescriptionsSeed";

const updated = await seedEventSeoDescriptionsIfMissing();
console.log(`Event SEO description backfill complete — ${updated} row(s) updated.`);
process.exit(0);
