import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, or, sql } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";
import { parseCsvAsObjects } from "./csv";
import { logger } from "./logger";
import { ricosToHtml } from "./ricos";

const VIDEO_CSV_NAME = "Videos_1776733452229.csv";
const LEGACY_VIDEO_CONTENT_SIGNATURES = [
  {
    sourceId: "1f3f1a8c-fe5c-4ac2-8694-c1899692c1ea",
    shortMd5: "8a438fab09b5866bf72e81e0ea6a8a81",
    bodyMd5: "c1253362934b728a0534e52ee69cbc72",
  },
  {
    sourceId: "34473b2b-60ac-4e40-a1d3-1042d109e8e9",
    shortMd5: "26f00c021bd82214598c23dbf4d96026",
    bodyMd5: "956670682108731d81f522bca4e40639",
  },
  {
    sourceId: "41c713bf-bce5-45a0-a865-2095a3d6c41a",
    shortMd5: "6a2be415f700e67d861d3624f37e3c36",
    bodyMd5: "8915514cc4b75539c471127c4042d296",
  },
  {
    sourceId: "51ccd5af-85dc-4dee-b7f8-deeb6c5a195b",
    shortMd5: "31bfa23bae1978a6c1360639e1262173",
    bodyMd5: "85498d3c322a31f28113d0a4fbe4b726",
  },
  {
    sourceId: "c21b498b-861f-481a-b02c-30089641add0",
    shortMd5: "86410bba20a1bf964a38df3fe8035b4a",
    bodyMd5: "0e2c4bbd54a929c1b5bd381805b9f2ca",
  },
] as const;

function readVideoCsv(): string {
  const candidates = [
    resolve(process.cwd(), "attached_assets", VIDEO_CSV_NAME),
    resolve(process.cwd(), "../../attached_assets", VIDEO_CSV_NAME),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      `Could not find ${VIDEO_CSV_NAME}; checked ${candidates.join(", ")}`,
    );
  }
  return readFileSync(path, "utf8");
}

type VideoContentFields = {
  shortDescription: string;
  bodyHtml: string;
};

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function ricosToShortText(json: string, maxLen = 300): string {
  const html = ricosToHtml(json) ?? "";
  const raw = stripHtml(html);
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
}

export function videoContentFieldsFromWix(
  fullDescription: string,
  shortDescriptionHtml: string,
): VideoContentFields {
  return {
    shortDescription:
      stripHtml(shortDescriptionHtml) || ricosToShortText(fullDescription),
    bodyHtml: ricosToHtml(fullDescription) || shortDescriptionHtml,
  };
}

/**
 * Repairs the original Wix video import, which populated short_description
 * from the full body and body_html from the short card description.
 *
 * The preflight signatures mean the historical CSV is read only while at least
 * one untouched legacy row still needs repair. After the migration succeeds,
 * later startups perform one cheap database check and never open the CSV.
 * Exact equality guards preserve any subsequent editor change.
 */
export async function repairImportedVideoContent(): Promise<number> {
  let updated = 0;
  try {
    const legacyRow = await db.query.videosTable.findFirst({
      columns: { id: true },
      where: or(
        ...LEGACY_VIDEO_CONTENT_SIGNATURES.map((signature) =>
          and(
            eq(videosTable.sourceId, signature.sourceId),
            sql`md5(${videosTable.shortDescription}) = ${signature.shortMd5}`,
            sql`md5(${videosTable.bodyHtml}) = ${signature.bodyMd5}`,
          ),
        ),
      ),
    });
    if (!legacyRow) return 0;

    const rows = parseCsvAsObjects(readVideoCsv());
    for (const row of rows) {
      const sourceId = row["ID"]?.trim();
      if (!sourceId) continue;

      const fullDescription = row["Full Description"] ?? "";
      const shortDescriptionHtml = row["Short Description"] ?? "";
      const legacyShortDescription = ricosToShortText(fullDescription);
      const legacyBodyHtml =
        shortDescriptionHtml || fullDescription.slice(0, 2000);
      const corrected = videoContentFieldsFromWix(
        fullDescription,
        shortDescriptionHtml,
      );

      const repaired = await db
        .update(videosTable)
        .set({ ...corrected, updatedAt: new Date() })
        .where(
          and(
            eq(videosTable.sourceId, sourceId),
            eq(videosTable.shortDescription, legacyShortDescription),
            eq(videosTable.bodyHtml, legacyBodyHtml),
          ),
        )
        .returning({ id: videosTable.id });
      updated += repaired.length;
    }
    if (updated > 0) {
      logger.info({ updated }, "Repaired reversed imported video content");
    }
  } catch (err) {
    logger.error({ err }, "Imported video content repair failed");
  }
  return updated;
}