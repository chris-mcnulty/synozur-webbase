import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import {
  rolesTable,
  ROLE_NAMES,
  categoriesTable,
  capabilitiesTable,
  roleCapabilities,
  CAPABILITY_NAMES,
  CAPABILITY_DESCRIPTIONS,
  DEFAULT_ROLE_CAPABILITIES,
  type RoleName,
  type CapabilityName,
} from "./schema";

async function main() {
  // 1. Roles (legacy + #110 audience classes).
  for (const name of ROLE_NAMES) {
    await db.insert(rolesTable).values({ name }).onConflictDoNothing();
  }

  // 2. Capabilities (#111 — DB-backed map).
  for (const name of CAPABILITY_NAMES) {
    await db
      .insert(capabilitiesTable)
      .values({ name, description: CAPABILITY_DESCRIPTIONS[name] })
      .onConflictDoNothing();
  }

  // 3. role_capabilities defaults. Only inserts missing rows so existing
  //    admin-edited grants survive a reseed.
  const roleRows = await db.select().from(rolesTable);
  const capRows = await db.select().from(capabilitiesTable);
  const roleId = new Map(roleRows.map((r) => [r.name as RoleName, r.id]));
  const capId = new Map(capRows.map((c) => [c.name as CapabilityName, c.id]));
  for (const name of ROLE_NAMES) {
    const rid = roleId.get(name);
    if (!rid) continue;
    for (const cap of DEFAULT_ROLE_CAPABILITIES[name]) {
      const cid = capId.get(cap);
      if (!cid) continue;
      await db
        .insert(roleCapabilities)
        .values({ roleId: rid, capabilityId: cid })
        .onConflictDoNothing();
    }
  }

  await db
    .insert(categoriesTable)
    .values({ slug: "general", name: "General", description: "Default category" })
    .onConflictDoNothing();

  console.log("Seed complete: roles + capabilities + default category ensured.");
  await pool.end();
}

// Suppress unused-import warning for the back-compat helper while the
// migration loop above is the actual consumer.
void eq;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
