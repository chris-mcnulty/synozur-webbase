import type { Request, Response, Router } from "express";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  ne,
  sql,
  type SQL,
  type AnyColumn,
} from "drizzle-orm";
import { type PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "./audit";
import { toSlug } from "./slug";

// Shared building blocks used by every artifact route module
// (videos, white_papers, workshops, applications, case_studies,
// polaris_episodes, plus new types like Offices). Before this existed
// each route reimplemented list pagination, slug uniqueness, soft-delete
// and audit semantics — slightly differently each time.

export type ArtifactTable = PgTable & {
  id: PgColumn;
  slug: PgColumn;
  deletedAt: PgColumn;
  createdAt: PgColumn;
  updatedAt: PgColumn;
  active: PgColumn;
};

export const ListQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;

// Mint a URL-safe slug that is unique within the given table, ignoring
// soft-deleted rows. `excludeId` lets updates keep their own slug.
export async function ensureUniqueSlugFor(
  table: ArtifactTable,
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  while (true) {
    const where = excludeId
      ? and(eq(t.slug, slug), ne(t.id, excludeId), isNull(t.deletedAt))
      : and(eq(t.slug, slug), isNull(t.deletedAt));
    const rows = await db.select({ id: t.id }).from(t).where(where).limit(1);
    if (rows.length === 0) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

// `status = 'published' and publishedAt <= now` if the table has those
// columns. Used by public list/detail routes.
export function publicVisibilityFilter(
  table: ArtifactTable,
  extras: { status?: AnyColumn; publishedAt?: AnyColumn; unpublishedAt?: AnyColumn } = {},
): SQL {
  const filters: SQL[] = [
    isNull(table.deletedAt as PgColumn) as SQL,
    eq(table.active as PgColumn, true) as SQL,
  ];
  if (extras.status) filters.push(eq(extras.status, "published") as SQL);
  if (extras.publishedAt) {
    filters.push(sql`${extras.publishedAt} is null or ${extras.publishedAt} <= now()`);
  }
  if (extras.unpublishedAt) {
    filters.push(sql`${extras.unpublishedAt} is null or ${extras.unpublishedAt} > now()`);
  }
  return and(...filters) as SQL;
}

// Standard ordering: featured first (nulls-last on featured_rank), then
// publishedAt desc, then title asc. Each of the ordering columns is
// optional so artifact types without featured_rank still work.
export function standardOrderBy(cols: {
  featured?: AnyColumn;
  featuredRank?: AnyColumn;
  publishedAt?: AnyColumn;
  title?: AnyColumn;
}): SQL[] {
  const out: SQL[] = [];
  if (cols.featured) out.push(sql`${cols.featured} desc`);
  if (cols.featuredRank) out.push(sql`${cols.featuredRank} asc nulls last`);
  if (cols.publishedAt) out.push(desc(cols.publishedAt) as SQL);
  if (cols.title) out.push(asc(cols.title) as SQL);
  return out;
}

// Drop-in async wrapper that catches thrown errors and returns 500.
// Express 5 no longer needs this for unhandled promise rejections, but
// the explicit typing lets route handlers return values without the
// async-ness leaking into Router's types.
export function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      req.log?.error({ err }, "artifact route failed");
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    }
  };
}

// Convenience: produce the [requireAuth, requireRole("admin","editor")]
// guard array used by every admin mutation endpoint.
export function adminGuard() {
  return [requireAuth, requireRole("admin", "editor")] as const;
}

export function readGuard() {
  return [requireAuth] as const;
}

// Soft-delete + audit in one call.
export async function softDeleteArtifact(args: {
  table: ArtifactTable;
  id: string;
  entity: string;
  actorId: string;
}): Promise<boolean> {
  const { table, id, entity, actorId } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  const existing = await db
    .select({ id: t.id, deletedAt: t.deletedAt })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  if (!existing.length || existing[0].deletedAt) return false;

  const now = new Date();
  await db
    .update(t)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(t.id, id));
  await audit({
    actorId,
    action: `${entity}.delete`,
    entity,
    entityId: id,
  });
  return true;
}

// Mount a simple public list route at `router.get(path)` filtered by the
// common visibility predicate. Callers that need custom filters should
// skip this helper and write the route directly.
export function mountPublicList(args: {
  router: Router;
  path: string;
  table: ArtifactTable;
  statusColumn?: AnyColumn;
  publishedAt?: AnyColumn;
  unpublishedAt?: AnyColumn;
  orderBy?: SQL[];
  serialize: (row: Record<string, unknown>) => unknown;
}): void {
  const { router, path, table, statusColumn, publishedAt, unpublishedAt, orderBy, serialize } =
    args;
  router.get(
    path,
    wrap(async (_req, res) => {
      const where = publicVisibilityFilter(table, {
        status: statusColumn,
        publishedAt,
        unpublishedAt,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query = db.select().from(table as any).where(where);
      const rows = orderBy ? await query.orderBy(...orderBy) : await query;
      res.json(rows.map((r) => serialize(r as Record<string, unknown>)));
    }),
  );
}
