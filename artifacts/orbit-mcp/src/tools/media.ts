import { z } from "zod";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db.js";
import { getApiUrl, getActiveKey, writesEnabled } from "../auth.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mediaTable } from "@workspace/db";

export function registerMediaTools(server: McpServer) {
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

  server.tool(
    "upload_image",
    "Upload an image to the media library. Accepts raw binary data as a base64-encoded string. Returns the registered media record including the public URL. Requires ORBIT_MCP_API_URL and ORBIT_MCP_WRITE_KEY to be configured.",
    {
      imageData: z.string().describe("Base64-encoded image bytes"),
      mimeType: z.string().describe("MIME type, e.g. image/jpeg, image/png, image/webp"),
      altText: z.string().min(1).describe("Descriptive alt text (required)"),
      filename: z.string().optional().describe("Original filename for the media library record"),
      categoryId: z.string().uuid().optional().describe("Asset category UUID"),
    },
    async ({ imageData, mimeType, altText, filename, categoryId }) => {
      if (!writesEnabled()) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "upload_image requires ORBIT_MCP_WRITE_KEY to be configured" }) }], isError: true };
      }
      const apiUrl = getApiUrl();
      const writeKey = getActiveKey();

      const buffer = Buffer.from(imageData, "base64");
      const name = filename ?? `orbit-upload-${Date.now()}.${mimeType.split("/")[1] ?? "bin"}`;

      // Step 1: request a presigned upload URL from the api-server.
      const reqUrlRes = await fetch(`${apiUrl}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${writeKey}`,
        },
        body: JSON.stringify({ name, size: buffer.length, contentType: mimeType }),
      });
      if (!reqUrlRes.ok) {
        const body = await reqUrlRes.text();
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to get upload URL: ${body}` }) }], isError: true };
      }
      const { uploadURL, objectPath } = (await reqUrlRes.json()) as { uploadURL: string; objectPath: string };

      // Step 2: PUT the bytes to the presigned URL (absolute or relative to api-server).
      const absoluteUploadUrl = uploadURL.startsWith("/") ? `${apiUrl}${uploadURL}` : uploadURL;
      const putRes = await fetch(absoluteUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          // Include auth for SPE direct-upload paths (server-relative); GCS presigned URLs don't need it.
          ...(uploadURL.startsWith("/") ? { Authorization: `Bearer ${writeKey}` } : {}),
        },
        body: buffer,
      });
      if (!putRes.ok) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Upload failed: ${putRes.status}` }) }], isError: true };
      }

      // Step 3: register the media record in the database.
      const publicUrl = `${apiUrl}/api/storage/public-objects/${objectPath}`;
      const registerRes = await fetch(`${apiUrl}/api/cms/media`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${writeKey}`,
        },
        body: JSON.stringify({
          storageKey: objectPath,
          publicUrl,
          mime: mimeType,
          byteSize: buffer.length,
          altText,
          originalName: name,
          ...(categoryId ? { categoryId } : {}),
        }),
      });
      if (!registerRes.ok) {
        const body = await registerRes.text();
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Media registration failed: ${body}` }) }], isError: true };
      }

      const media = (await registerRes.json()) as { id: string; publicUrl: string };
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ id: media.id, publicUrl: media.publicUrl, altText, mime: mimeType }),
        }],
      };
    },
  );
}
