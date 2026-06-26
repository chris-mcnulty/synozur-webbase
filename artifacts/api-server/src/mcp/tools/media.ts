import { z } from "zod";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { siteOrigin } from "../../lib/siteOrigin.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const objectStorageService = new ObjectStorageService();

export function registerMediaTools(server: McpServer, writes: boolean) {
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
      const items = await baseQuery.orderBy(desc(mediaTable.createdAt)).limit(pageSize).offset(offset);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            items: items.map((m) => ({
              id: m.id,
              publicUrl: m.publicUrl,
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
