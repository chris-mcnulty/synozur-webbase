import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db, eventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Minimal CSV parser that handles quoted fields with commas.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

export interface SeedEventsResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export async function seedEventsFromCsv(raw: string): Promise<SeedEventsResult> {
  const rows = parseCsv(raw.replace(/^﻿/, ""));
  const [header, ...data] = rows;
  const idx = (name: string) => header.indexOf(name);
  const titleIdx = idx("title");
  const startIdx = idx("start date");
  const locIdx = idx("location");
  const regIdx = idx("registration");
  const typeIdx = idx("type");
  const statusIdx = idx("status");
  const teaserIdx = idx("teaser");
  const descriptionIdx = idx("description");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const usedSlugs = new Set<string>();

  for (const row of data) {
    const title = row[titleIdx]?.trim();
    const start = row[startIdx]?.trim();
    if (!title || !start) {
      skipped++;
      continue;
    }

    let slug = slugify(title);
    let candidate = slug;
    let n = 2;
    while (usedSlugs.has(candidate)) candidate = `${slug}-${n++}`;
    slug = candidate;
    usedSlugs.add(slug);

    // Fields that are always sourced from CSV (present in every export).
    const baseValues = {
      startDate: new Date(start),
      location: row[locIdx]?.trim() || null,
      registrationStatus: row[regIdx]?.trim() || "UNKNOWN_REGISTRATION_STATUS",
      eventType: row[typeIdx]?.trim() || "RSVP",
      status: row[statusIdx]?.trim() || "UPCOMING",
    };

    // Optional columns — only applied when the CSV actually contains them.
    // This lets the default Wix export preserve user-edited teaser/description
    // values in the DB, while a reload CSV with those columns overrides them.
    const optional: { teaser?: string | null; description?: string | null } = {};
    if (teaserIdx !== -1) optional.teaser = row[teaserIdx]?.trim() || null;
    if (descriptionIdx !== -1)
      optional.description = row[descriptionIdx]?.trim() || null;

    const existing = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.slug, slug));

    if (existing.length > 0) {
      await db
        .update(eventsTable)
        .set({ title, ...baseValues, ...optional })
        .where(eq(eventsTable.id, existing[0].id));
      updated++;
    } else {
      await db.insert(eventsTable).values({
        title,
        slug,
        ...baseValues,
        ...optional,
      });
      inserted++;
    }
  }
  return { inserted, updated, skipped };
}

async function main() {
  const csvPath = resolve(
    process.cwd(),
    "../../attached_assets/events_1776704614264.csv",
  );
  const raw = readFileSync(csvPath, "utf8");
  const result = await seedEventsFromCsv(raw);
  console.log(
    `Seed complete. Inserted ${result.inserted}, updated ${result.updated}, skipped ${result.skipped}.`,
  );
}

// Only execute as a script when invoked directly (not when imported by routes).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /seedEvents\.(ts|mts|cjs|mjs|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
