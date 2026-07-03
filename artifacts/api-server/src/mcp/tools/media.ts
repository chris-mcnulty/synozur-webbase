import { z } from "zod";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, mediaTable, assetCategoriesTable } from "@workspace/db";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { siteOrigin } from "../../lib/siteOrigin.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const objectStorageService = new ObjectStorageService();

export function registerMediaTools(server: McpServer, writes: boolean) {
  server.tool(
    "list_media_categories",
    "List all asset categories in the media library. Returns each category's ID, name, and slug — pass categoryId into list_media to filter by category.",
    {},
    async () => {
      const rows = await db
        .select({
          id: assetCategoriesTable.id,
          name: assetCategoriesTable.label,
          slug: assetCategoriesTable.slug,
          createdAt: assetCategoriesTable.createdAt,
        })
        .from(assetCategoriesTable)
        .orderBy(asc(assetCategoriesTable.label));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            categories: rows.map((r) => ({
              id: r.id,
              name: r.name,
              slug: r.slug,
              createdAt: r.createdAt.toISOString(),
            })),
          }),
        }],
      };
    },
  );

  server.tool(
    "list_media",
    "Search the media library. Returns image and document records with their public URLs.",
    {
      query: z.string().optional().describe("Search by alt text or filename"),
      categoryId: z.string().uuid().optional().describe("Filter by asset category UUID"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    },
    async ({ query, categoryId, page, pageSize }) => {
      const offset = (page - 1) * pageSize;
      const conditions = [];

      if (query) {
        const like = `%${query}%`;
        const expr = or(ilike(mediaTable.altText, like), ilike(mediaTable.originalName, like));
        if (expr) conditions.push(expr);
      }
      if (categoryId) conditions.push(eq(mediaTable.categoryId, categoryId));

      const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
      const baseQuery = where ? db.select().from(mediaTable).where(where) : db.select().from(mediaTable);
      const countQuery = where
        ? db.select({ c: sql<number>`count(*)::int` }).from(mediaTable).where(where)
        : db.select({ c: sql<number>`count(*)::int` }).from(mediaTable);

      const [items, totalRows] = await Promise.all([
        baseQuery.orderBy(desc(mediaTable.createdAt)).limit(pageSize).offset(offset),
        countQuery,
      ]);

      const total = totalRows[0]?.c ?? 0;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            items: items.map((m) => ({
              id: m.id,
              publicUrl: m.publicUrl,
              storageKey: m.storageKey,
              altText: m.altText,
              mime: m.mime ?? null,
              width: m.width ?? null,
              height: m.height ?? null,
              byteSize: m.byteSize ?? null,
              originalName: m.originalName ?? null,
              categoryId: m.categoryId ?? null,
              createdAt: m.createdAt.toISOString(),
            })),
            page,
            pageSize,
            total,
          }),
        }],
      };
    },
  );

  server.tool(
    "get_media",
    "Fetch a single media asset by its UUID. Returns the full record including storageKey and a pre-built optimizedUrl (1200 px wide WebP) ready for embedding in documents.",
    {
      id: z.string().uuid().describe("Media asset UUID"),
    },
    async ({ id }) => {
      const [row] = await db
        .select()
        .from(mediaTable)
        .where(eq(mediaTable.id, id))
        .limit(1);

      if (!row) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Media asset not found", id }) }],
          isError: true,
        };
      }

      const isImage = row.mime?.startsWith("image/") ?? false;
      const optimizedUrl = isImage
        ? `${siteOrigin()}/api/storage/objects/${row.storageKey.replace(/^\/objects\//, "")}?w=1200&fmt=webp`
        : null;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: row.id,
            publicUrl: row.publicUrl,
            storageKey: row.storageKey,
            altText: row.altText,
            mime: row.mime ?? null,
            width: row.width ?? null,
            height: row.height ?? null,
            byteSize: row.byteSize ?? null,
            originalName: row.originalName ?? null,
            categoryId: row.categoryId ?? null,
            createdAt: row.createdAt.toISOString(),
            optimizedUrl,
          }),
        }],
      };
    },
  );

  if (!writes) return;

  server.tool(
    "upload_image",
    "Upload an image to the media library. Accepts raw binary data as a base64-encoded string. Returns the registered media record including the public URL.",
    {
      imageData: z.string().describe("Base64-encoded image bytes"),
      mimeType: z.string().describe("MIME type, e.g. image/jpeg, image/png, image/webp"),
      altText: z.string().min(1).describe("Descriptive alt text (required)"),
      filename: z.string().optional().describe("Original filename for the media library record"),
      categoryId: z.string().uuid().optional().describe("Asset category UUID"),
    },
    async ({ imageData, mimeType, altText, filename, categoryId }) => {
      try {
        const buffer = Buffer.from(imageData, "base64");
        const name = filename ?? `mcp-upload.${mimeType.split("/")[1] ?? "bin"}`;

        const ref = await objectStorageService.uploadObject({
          body: buffer,
          contentType: mimeType,
          filename: name,
          documentType: "media",
          ownerId: "mcp",
        });

        // Normalize storageKey to /objects/uploads/<id> for SPE rows so the
        // /api/storage/public-objects/* route can look it up by storageKey.
        // SPE dispatch still works because speFileId is set on the row.
        const storageKey = ref.speFileId
          ? `/objects/uploads/${ref.speFileId}`
          : ref.storageKey;
        const publicUrl = `${siteOrigin()}/api/storage/public-objects/${storageKey.replace(/^\/objects\//, "")}`;

        const [media] = await db
          .insert(mediaTable)
          .values({
            storageKey,
            publicUrl,
            mime: mimeType,
            byteSize: buffer.length,
            altText,
            originalName: name,
            categoryId: categoryId ?? null,
            speFileId: ref.speFileId ?? null,
            speContainerId: ref.speContainerId ?? null,
          })
          .returning({ id: mediaTable.id, publicUrl: mediaTable.publicUrl });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ id: media!.id, publicUrl: media!.publicUrl, altText, mime: mimeType }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Upload failed: ${String(err)}` }) }],
          isError: true,
        };
      }
    },
  );
}
