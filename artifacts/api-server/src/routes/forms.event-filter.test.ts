import test, { after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "@workspace/db";
import {
  ListAdminFormSubmissionsQueryParams,
  ExportAdminFormSubmissionsQueryParams,
  RetryFailedAdminFormSubmissionsQueryParams,
} from "@workspace/api-zod";
import { buildSubmissionFilter } from "./forms";

after(async () => { await pool.end(); });

// Read-only fixtures: no real registrations are read, created, or changed.
const fixtures = sql`(values
  (1, 'event_registration', '{"eventSlug":"tribal","eventTitle":"Tribal event"}'::jsonb, 'alex@example.test', 'Alex', 'Contoso'),
  (2, 'event_registration', '{"eventSlug":"other"}'::jsonb, 'alex@example.test', 'Alex', 'Contoso'),
  (3, 'contact', '{"eventSlug":"tribal"}'::jsonb, 'alex@example.test', 'Alex', 'Contoso'),
  (4, 'event_registration', '{}'::jsonb, 'sam@example.test', 'Sam', 'Fabrikam'),
  (5, 'event_registration', '{"eventSlug":"tribal"}'::jsonb, 'sam@example.test', 'Sam', 'Fabrikam')
) as form_submissions(id, form_type, payload, email, name, company)`;

async function matchingIds(formType?: string, search?: string, eventSlug?: string) {
  const where = buildSubmissionFilter(formType, search, eventSlug);
  const result = await db.execute(sql`select id from ${fixtures} ${where ? sql`where ${where}` : sql``} order by id`);
  return result.rows.map((row) => row.id);
}

test("list, export and bulk retry accept and retain the same event filter", () => {
  for (const schema of [
    ListAdminFormSubmissionsQueryParams,
    ExportAdminFormSubmissionsQueryParams,
    RetryFailedAdminFormSubmissionsQueryParams,
  ]) {
    assert.equal(schema.parse({ eventSlug: "tribal" }).eventSlug, "tribal");
    assert.equal(schema.safeParse({ eventSlug: "" }).success, false);
  }
});

test("event selector matches the exact slug and only event registrations", async () => {
  assert.deepEqual(await matchingIds(undefined, undefined, "tribal"), [1, 5]);
});

test("event filter combines with contact search", async () => {
  assert.deepEqual(await matchingIds("event_registration", "Contoso", "tribal"), [1]);
  assert.deepEqual(await matchingIds("event_registration", "sam@example.test", "tribal"), [5]);
});

test("all-events, clear, and non-event form filters retain their behavior", async () => {
  assert.deepEqual(await matchingIds("event_registration"), [1, 2, 4, 5]);
  assert.deepEqual(await matchingIds(), [1, 2, 3, 4, 5]);
  assert.deepEqual(await matchingIds("contact"), [3]);
});

test("a missing or conflicting event returns no registrations", async () => {
  assert.deepEqual(await matchingIds(undefined, undefined, "missing"), []);
  assert.deepEqual(await matchingIds("contact", undefined, "tribal"), []);
});

test("event slug is a bound value, not SQL or a wildcard match", async () => {
  const value = "tribal' OR true --%";
  const query = new PgDialect().sqlToQuery(buildSubmissionFilter(undefined, undefined, value)!);
  assert.ok(query.params.includes(value));
  assert.ok(!query.sql.includes(value));
  assert.deepEqual(await matchingIds(undefined, undefined, value), []);
});
