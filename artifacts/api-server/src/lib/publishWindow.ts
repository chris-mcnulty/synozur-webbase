import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

// Publish dates for date-only admin pickers are stored as midnight UTC.
// Content dated "today" must be publicly visible immediately, i.e. its
// publishedAt is strictly before the start of the next UTC day.
// (See routes/whitePapers.ts / #466 for the original fix.)
export function startOfNextUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

// JS-side check: is a row's publishedAt visible right now at date granularity?
export function isPublishedAtVisible(
  publishedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return !publishedAt || publishedAt < startOfNextUtcDay(now);
}

// Drizzle SQL fragment: `publishedAt` reached at date granularity.
export function publishedAtReachedSql(publishedAt: PgColumn): SQL {
  return sql`${publishedAt} < date_trunc('day', now() at time zone 'utc') + interval '1 day'`;
}

// Same, but treating NULL publishedAt as visible.
export function publishedAtNullOrReachedSql(publishedAt: PgColumn): SQL {
  return sql`(${publishedAt} is null or ${publishedAt} < date_trunc('day', now() at time zone 'utc') + interval '1 day')`;
}

// Raw-SQL string version for hand-written queries (e.g. search.ts).
export const PUBLISHED_AT_REACHED_RAW =
  "published_at < date_trunc('day', now() at time zone 'utc') + interval '1 day'";
