// One-off: provision Synozur* custom columns on all configured SPE containers.
// Safe to re-run — 409 nameAlreadyExists is treated as success.
//
// Usage:
//   pnpm --filter @workspace/api-server run provision:spe-columns

import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import { SpeGraphClient, readSpeGraphConfigFromEnv } from "../lib/storage/spe/graphClient.js";
import { SpeContainerCreator } from "../lib/storage/spe/containerCreator.js";

const SETTINGS_ID = 1;

async function main() {
  const cfg = readSpeGraphConfigFromEnv();
  if (!cfg) {
    console.error(
      "❌  SPE credentials not set — ENTRA_TENANT_ID, ENTRA_APP_CLIENT_ID, " +
        "ENTRA_APP_CLIENT_SECRET must all be present.",
    );
    process.exit(1);
  }

  const settings = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, SETTINGS_ID),
  });

  const containers: Array<{ slot: string; containerId: string }> = [];
  if (settings?.speContainerIdDev) {
    containers.push({ slot: "dev", containerId: settings.speContainerIdDev });
  }
  if (settings?.speContainerIdProd) {
    containers.push({ slot: "prod", containerId: settings.speContainerIdProd });
  }

  if (containers.length === 0) {
    console.error("❌  No SPE containers configured in site_settings.");
    process.exit(1);
  }

  const graph = new SpeGraphClient(cfg);
  const creator = new SpeContainerCreator(graph);

  for (const { slot, containerId } of containers) {
    console.log(`\nProvisioning columns on ${slot} container: ${containerId}`);
    try {
      const result = await creator.provisionColumns(containerId);
      if (result.created.length > 0) {
        console.log(`  ✅ Created: ${result.created.join(", ")}`);
      }
      if (result.existed.length > 0) {
        console.log(`  ℹ️  Already existed: ${result.existed.join(", ")}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed on ${slot}:`, (err as Error).message);
      process.exit(1);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
