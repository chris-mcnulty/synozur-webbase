/**
 * Creates missing author user accounts and re-assigns all imported blog posts
 * to their real authors based on the `authorName` field in posts.json.
 *
 * Idempotent — safe to re-run.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, postsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const POSTS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../tools/insights-crawler/output/posts.json",
);

// Known Synozur authors — canonical name → account details.
// "andrewborg88" is Andrew Borg's Wix username; merge into Andrew Borg.
const KNOWN_AUTHORS: Record<string, { name: string; email: string }> = {
  "Chris McNulty": {
    name: "Chris McNulty",
    email: "chris.mcnulty@synozur.com",
  },
  "Michelle Caldwell": {
    name: "Michelle Caldwell",
    email: "michelle.caldwell@synozur.com",
  },
  "Andrew Borg": {
    name: "Andrew Borg",
    email: "andrew.borg@synozur.com",
  },
  andrewborg88: {
    name: "Andrew Borg",
    email: "andrew.borg@synozur.com",
  },
  "Ruven Gotz": {
    name: "Ruven Gotz",
    email: "ruven.gotz@synozur.com",
  },
  "Austin Govella": {
    name: "Austin Govella",
    email: "austin.govella@synozur.com",
  },
};

interface CrawledPost {
  slug: string;
  authorName?: string | null;
}

async function findOrCreateUser(
  displayName: string,
  email: string,
): Promise<string> {
  // Look up by email (most reliable)
  const rows = await db.execute(
    sql`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`,
  );
  if (rows.rows.length > 0) {
    const id = rows.rows[0].id as string;
    console.log(`  ✓ exists: ${displayName} (${id})`);
    return id;
  }

  // Not found — create the account. These rows are placeholders for imported
  // author bylines and have no upstream identity yet; sign-in via Entra
  // populates externalSubject/authProvider when the matching email signs in.
  const result = await db
    .insert(usersTable)
    .values({
      displayName,
      email,
      authProvider: "imported",
      externalSubject: `imported:${email.split("@")[0]}`,
    })
    .onConflictDoNothing()
    .returning({ id: usersTable.id });

  if (result.length > 0) {
    console.log(`  + created: ${displayName} → ${email} (${result[0].id})`);
    return result[0].id;
  }

  // Conflict — fetch it
  const retry = await db.execute(
    sql`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`,
  );
  if (retry.rows.length > 0) return retry.rows[0].id as string;
  throw new Error(`Could not create or fetch user: ${email}`);
}

async function main() {
  const raw = readFileSync(POSTS_PATH, "utf8");
  const posts: CrawledPost[] = JSON.parse(raw);

  // Build slug → canonical author info
  const slugToAuthor: Record<
    string,
    { name: string; email: string }
  > = {};
  for (const p of posts) {
    const rawName = p.authorName?.trim();
    if (!rawName) continue;
    const canonical = KNOWN_AUTHORS[rawName];
    if (!canonical) {
      console.warn(`  ⚠ Unknown author "${rawName}" for slug ${p.slug} — skipping`);
      continue;
    }
    slugToAuthor[p.slug] = canonical;
  }

  // Unique canonical authors
  const seen = new Set<string>();
  const uniqueAuthors: { name: string; email: string }[] = [];
  for (const a of Object.values(slugToAuthor)) {
    if (!seen.has(a.email)) {
      seen.add(a.email);
      uniqueAuthors.push(a);
    }
  }

  console.log(`\nResolving ${uniqueAuthors.length} author accounts…`);
  const emailToId: Record<string, string> = {};
  for (const a of uniqueAuthors) {
    emailToId[a.email] = await findOrCreateUser(a.name, a.email);
  }

  // Update posts
  console.log("\nAssigning authors to posts…");
  let updated = 0;
  let skipped = 0;

  for (const [slug, author] of Object.entries(slugToAuthor)) {
    const userId = emailToId[author.email];
    const result = await db
      .update(postsTable)
      .set({ authorId: userId })
      .where(eq(postsTable.slug, slug))
      .returning({ id: postsTable.id });

    if (result.length > 0) {
      updated++;
    } else {
      skipped++;
      console.log(`  ⚠ no DB row for slug: ${slug}`);
    }
  }

  // Fix the 4 stub posts that used the chris.mcnulty account
  const chrisId = emailToId["chris.mcnulty@synozur.com"];
  if (chrisId) {
    const stubSlugs = [
      "polaris-ai-predictions-2025",
      "holiday-reflections-from-synozur-a-dynamic-2024",
      "polaris-podcast-fractional-cxos-get-our-undivided-attention",
      "polaris-strategy-unplugged-with-dr-john-hillen",
    ];
    for (const slug of stubSlugs) {
      if (!slugToAuthor[slug]) {
        const r = await db
          .update(postsTable)
          .set({ authorId: chrisId })
          .where(eq(postsTable.slug, slug))
          .returning({ id: postsTable.id });
        if (r.length > 0) updated++;
      }
    }
  }

  console.log(`\nDone. Updated ${updated} posts, ${skipped} slugs not found in DB.`);

  // Final summary
  const summary = await db.execute(
    sql`SELECT u.name, COUNT(p.id)::int AS posts
        FROM posts p
        JOIN users u ON u.id = p.author_id
        GROUP BY u.name
        ORDER BY posts DESC`,
  );
  console.log("\nPost counts by author:");
  for (const r of summary.rows) {
    console.log(`  ${r.name}: ${r.posts}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
