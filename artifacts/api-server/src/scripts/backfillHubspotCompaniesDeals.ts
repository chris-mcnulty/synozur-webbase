/**
 * #463 — One-time backfill: enqueue company.upsert and deal.upsert events
 * in the HubSpot sync queue for all existing (non-deleted) client organizations
 * and engagements that have not yet been synced.
 *
 * Safe to run multiple times (idempotent):
 *   - Rows with an existing hubspotCompanyId / hubspotDealId are skipped.
 *   - Rows that already have a live (pending, in_flight, or succeeded) event
 *     in the queue are skipped — prevents duplicate queue entries if the
 *     script is re-run while the queue is still draining.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server backfill:hubspot-companies-deals [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Print what would be enqueued without writing anything.
 *   --limit N   Stop after enqueueing N rows total (default: no limit).
 *
 * Prerequisites:
 *   - HubSpot must be enabled in site_settings (hubspot_enabled = true).
 *   - The crm.objects.companies.write and crm.objects.deals.write scopes must
 *     be authorized on the connected HubSpot account.
 *   - Run bootstrapHubspotProperties first so synozur_client_slug,
 *     synozur_engagement_id, and synozur_engagement_status custom properties
 *     exist on the HubSpot portal.
 *   - Run against the correct DATABASE_URL (dev or prod).
 */

import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  clientOrganizationsTable,
  engagementsTable,
  hubspotSyncEventsTable,
} from "@workspace/db";
import { enqueueCompanyUpsert, enqueueDealUpsert } from "../lib/hubspotSync";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit=")) ?? args[args.indexOf("--limit") + 1];
const LIMIT = limitArg && Number.isFinite(Number(limitArg)) ? Number(limitArg) : Infinity;

/** Active statuses — a row with any of these already covers this org/engagement. */
const LIVE_STATUSES = ["pending", "in_flight", "succeeded"] as const;

async function hasLiveEvent(kind: string, payloadKey: "orgId" | "engagementId", id: string): Promise<boolean> {
  const rows = await db
    .select({ id: hubspotSyncEventsTable.id })
    .from(hubspotSyncEventsTable)
    .where(
      and(
        eq(hubspotSyncEventsTable.kind, kind),
        inArray(hubspotSyncEventsTable.status, [...LIVE_STATUSES]),
        // JSON path: payload->>'orgId' or payload->>'engagementId'
        sql`(payload->>${payloadKey}) = ${id}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function main() {
  console.log(`HubSpot backfill: ${DRY_RUN ? "DRY RUN — no writes" : "LIVE"}`);

  // ---------------------------------------------------------------
  // 1. Client organizations → company.upsert
  // ---------------------------------------------------------------
  const orgs = await db
    .select()
    .from(clientOrganizationsTable)
    .where(
      and(
        isNull(clientOrganizationsTable.deletedAt),
        isNull(clientOrganizationsTable.hubspotCompanyId),
      ),
    );

  console.log(`Found ${orgs.length} organization(s) without a hubspotCompanyId`);
  let companyCount = 0;
  let companySkipped = 0;
  for (const org of orgs) {
    if (companyCount >= LIMIT) break;

    // Skip if there is already a live queue event covering this org.
    const alreadyQueued = await hasLiveEvent("company.upsert", "orgId", org.id);
    if (alreadyQueued) {
      console.log(`  [skip] ${org.name} (${org.id}) — already has a live company.upsert event`);
      companySkipped++;
      continue;
    }

    console.log(`  [org] ${org.name} (${org.id})`);
    if (!DRY_RUN) {
      await enqueueCompanyUpsert({
        orgId: org.id,
        name: org.name,
        slug: org.slug,
        approvedEmailDomains: org.approvedEmailDomains ?? [],
      });
    }
    companyCount++;
  }
  console.log(`Enqueued ${DRY_RUN ? "(dry) " : ""}${companyCount} company.upsert event(s), skipped ${companySkipped}`);

  // ---------------------------------------------------------------
  // 2. Engagements → deal.upsert
  // ---------------------------------------------------------------
  const engagements = await db
    .select()
    .from(engagementsTable)
    .where(
      and(
        isNull(engagementsTable.deletedAt),
        isNull(engagementsTable.hubspotDealId),
      ),
    );

  console.log(`Found ${engagements.length} engagement(s) without a hubspotDealId`);
  let dealCount = 0;
  let dealSkipped = 0;
  for (const eng of engagements) {
    if (companyCount + dealCount >= LIMIT) break;

    // Skip if there is already a live queue event covering this engagement.
    const alreadyQueued = await hasLiveEvent("deal.upsert", "engagementId", eng.id);
    if (alreadyQueued) {
      console.log(`  [skip] ${eng.title} (${eng.id}) — already has a live deal.upsert event`);
      dealSkipped++;
      continue;
    }

    console.log(`  [eng] ${eng.title} (${eng.id})`);
    if (!DRY_RUN) {
      await enqueueDealUpsert({
        engagementId: eng.id,
        title: eng.title,
        status: eng.status,
        summary: eng.summary,
        startedAt: eng.startedAt,
        clientOrganizationId: eng.clientOrganizationId,
      });
    }
    dealCount++;
  }
  console.log(`Enqueued ${DRY_RUN ? "(dry) " : ""}${dealCount} deal.upsert event(s), skipped ${dealSkipped}`);
  console.log("Done.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
