import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db, eventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"\u2018\u2019\u201C\u201D]/g, "")
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

async function main() {
  const csvPath = resolve(
    process.cwd(),
    "../../attached_assets/events_1776704614264.csv",
  );
  const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(raw);
  const [header, ...data] = rows;
  const idx = (name: string) => header.indexOf(name);
  const titleIdx = idx("title");
  const startIdx = idx("start date");
  const locIdx = idx("location");
  const regIdx = idx("registration");
  const typeIdx = idx("type");
  const statusIdx = idx("status");

  let inserted = 0;
  let skipped = 0;
  const usedSlugs = new Set<string>();
  for (const row of data) {
    const title = row[titleIdx]?.trim();
    const start = row[startIdx]?.trim();
    if (!title || !start) continue;

    let slug = slugify(title);
    let candidate = slug;
    let n = 2;
    while (usedSlugs.has(candidate)) {
      candidate = `${slug}-${n++}`;
    }
    slug = candidate;
    usedSlugs.add(slug);

    const existing = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.slug, slug));
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(eventsTable).values({
      title,
      slug,
      startDate: new Date(start),
      location: row[locIdx]?.trim() || null,
      registrationStatus:
        row[regIdx]?.trim() || "UNKNOWN_REGISTRATION_STATUS",
      eventType: row[typeIdx]?.trim() || "RSVP",
      status: row[statusIdx]?.trim() || "UPCOMING",
    });
    inserted++;
  }
  console.log(`Seed complete. Inserted ${inserted}, skipped ${skipped}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
