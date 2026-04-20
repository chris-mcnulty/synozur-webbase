import { db, pool } from "./index";
import { rolesTable, ROLE_NAMES, categoriesTable } from "./schema";

async function main() {
  for (const name of ROLE_NAMES) {
    await db.insert(rolesTable).values({ name }).onConflictDoNothing();
  }

  await db
    .insert(categoriesTable)
    .values({ slug: "general", name: "General", description: "Default category" })
    .onConflictDoNothing();

  console.log("Seed complete: roles + default category ensured.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
