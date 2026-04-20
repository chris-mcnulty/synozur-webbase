import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { db, teamMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

function slugFromTeamItem(itemPath: string, fallback: string): string {
  // "Team (Item)" looks like "/team/josh-brantley"
  const parts = itemPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

interface ParsedWixImage {
  fileId: string;
  filename: string;
  ext: string;
}

function parseWixImage(raw: string): ParsedWixImage | null {
  // wix:image://v1/<fileId>/<filename>#originWidth=...
  const m = raw.match(/^wix:image:\/\/v1\/([^/]+)\/([^#?]+)/);
  if (!m) return null;
  const fileId = m[1];
  const filename = decodeURIComponent(m[2]);
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "png";
  return { fileId, filename, ext };
}

async function downloadImage(fileId: string): Promise<Buffer> {
  const url = `https://static.wixstatic.com/media/${fileId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((t) => String(t));
  } catch {
    /* fall through */
  }
  return raw
    .split(",")
    .map((t) => t.trim().replace(/^\[|\]$/g, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
}

async function main() {
  const here = new URL(".", import.meta.url).pathname;
  const csvPath = resolve(
    here,
    "../../../../attached_assets/Team_1776707186693.csv",
  );
  const imageDir = resolve(
    here,
    "../../../synozur/public/images/team",
  );
  mkdirSync(imageDir, { recursive: true });

  const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(raw);
  const [header, ...data] = rows;
  const idx = (name: string) => header.indexOf(name);
  const nameIdx = idx("Name");
  const teamItemIdx = idx("Team (Item)");
  const photoIdx = idx("Photo");
  const titleIdx = idx("Job Title");
  const shortIdx = idx("Short Description");
  const longIdx = idx("Long Description");
  const websiteIdx = idx("Website");
  const emailIdx = idx("Email");
  const phoneIdx = idx("Phone");
  const linkedinIdx = idx("LinkedIn");
  const activeIdx = idx("Active");
  const tagsIdx = idx("Tags");
  const sortIdx = idx("Manual sort");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of data) {
    const name = row[nameIdx]?.trim();
    const teamItem = row[teamItemIdx]?.trim() ?? "";
    if (!name) continue;
    const slug = slugFromTeamItem(
      teamItem,
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    );

    const photoRaw = row[photoIdx]?.trim() ?? "";
    let imageUrl: string | null = null;
    const parsed = parseWixImage(photoRaw);
    if (parsed) {
      const localName = `${slug}.${parsed.ext}`;
      const localPath = resolve(imageDir, localName);
      if (!existsSync(localPath)) {
        try {
          const buf = await downloadImage(parsed.fileId);
          writeFileSync(localPath, buf);
          console.log(`  downloaded ${slug} -> ${localName} (${buf.length} bytes)`);
        } catch (err) {
          console.warn(`  WARN failed to download ${slug}:`, err);
        }
      }
      imageUrl = `/images/team/${localName}`;
    }

    const activeRaw = (row[activeIdx] ?? "").trim().toLowerCase();
    const active = activeRaw === "true" || activeRaw === "1" || activeRaw === "yes";

    const values = {
      name,
      slug,
      jobTitle: row[titleIdx]?.trim() ?? "",
      shortDescription: row[shortIdx]?.trim() || null,
      longDescription: row[longIdx]?.trim() || null,
      imageUrl,
      website: row[websiteIdx]?.trim() || null,
      email: row[emailIdx]?.trim() || null,
      phone: row[phoneIdx]?.trim() || null,
      linkedinUrl: row[linkedinIdx]?.trim() || null,
      active,
      manualSort: row[sortIdx]?.trim() || "",
      tags: parseTags(row[tagsIdx]?.trim() ?? ""),
    };

    const existing = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.slug, slug));

    if (existing.length === 0) {
      await db.insert(teamMembersTable).values(values);
      inserted++;
    } else {
      await db
        .update(teamMembersTable)
        .set(values)
        .where(eq(teamMembersTable.id, existing[0].id));
      updated++;
    }
  }

  console.log(
    `Team seed complete. Inserted ${inserted}, updated ${updated}, skipped ${skipped}.`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
