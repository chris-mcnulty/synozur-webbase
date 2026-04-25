import { and, eq, sql } from "drizzle-orm";
import { db, hubspotSyncEventsTable, siteSettingsTable, formSubmissionsTable } from "@workspace/db";
import { logger } from "./logger";

// #131: HubSpot lead-capture sync
//
// Form handlers enqueue rows in `hubspot_sync_events` instead of calling
// HubSpot inline. A short-interval worker (`startHubspotWorker`) drains the
// queue with exponential backoff. Persisting outside the request path means:
//   * a HubSpot outage doesn't slow down or break form responses
//   * admins can replay individual failures from /admin/integrations/hubspot
//   * sales sees an audit trail of every event, regardless of provider state
//
// Two event kinds:
//   - "contact.upsert"            — create-or-update a Contact by email
//   - "timeline.<eventTemplateId>" — emit a custom timeline event against a
//     contact (HubSpot timeline events require a registered app + template id)

const HUBSPOT_API = "https://api.hubapi.com";
const MAX_ATTEMPTS = 6;

export type FormType = "contact" | "subscribe" | "start";

export type LifecycleStage = "subscriber" | "lead" | "marketingqualifiedlead" | "salesqualifiedlead" | "opportunity" | "customer" | "evangelist" | "other";

export interface ContactProperties {
  email: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  jobtitle?: string;
  phone?: string;
  message?: string;
  lifecyclestage?: LifecycleStage;
  // First-touch attribution.
  hs_analytics_first_url?: string;
  hs_analytics_first_referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  // GDPR / consent
  hs_legal_basis?: string;
  // Custom Synozur properties (must exist on the portal — created via the
  // bootstrap script in scripts/bootstrapHubspotProperties.ts).
  synozur_form_type?: string;
  synozur_marketing_opt_in?: "true" | "false";
}

export interface EnqueueContactArgs {
  formType: FormType;
  submissionId: number;
  email: string;
  name: string | null;
  company: string | null;
  marketingOptIn: boolean;
  payload: Record<string, unknown>;
  utm: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    term?: string | null;
    content?: string | null;
    landingPage?: string | null;
    referrer?: string | null;
  };
}

function nowPlus(ms: number): Date {
  return new Date(Date.now() + ms);
}

function backoffMs(attempts: number): number {
  // 0 → ~5s, 1 → ~30s, 2 → ~2m, 3 → ~10m, 4 → ~30m, ≥5 → 1h cap
  const ladder = [5_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000];
  return ladder[Math.min(attempts, ladder.length - 1)];
}

function lifecycleFor(formType: FormType, mappings: Record<string, string> | null | undefined): LifecycleStage {
  const explicit = mappings?.[formType];
  if (explicit) return explicit as LifecycleStage;
  if (formType === "subscribe") return "subscriber";
  if (formType === "start") return "marketingqualifiedlead";
  return "lead";
}

function splitName(name: string | null): { firstname?: string; lastname?: string } {
  if (!name) return {};
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts[0]!, lastname: parts.slice(1).join(" ") };
}

async function loadSettings() {
  const row = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, 1),
  });
  return row ?? null;
}

export async function isHubspotConfigured(): Promise<boolean> {
  const token = process.env["HUBSPOT_ACCESS_TOKEN"];
  if (!token) return false;
  const settings = await loadSettings();
  return settings?.hubspotEnabled === true;
}

export async function enqueueContactSubmission(args: EnqueueContactArgs): Promise<void> {
  const settings = await loadSettings();
  if (!settings || settings.hubspotEnabled !== true) return;
  const toggles = (settings.hubspotFormToggles ?? {}) as Record<string, boolean>;
  if (toggles[args.formType] === false) return;

  const lifecycle = lifecycleFor(
    args.formType,
    settings.hubspotLifecycleMappings as Record<string, string> | null,
  );
  const { firstname, lastname } = splitName(args.name);
  const message = typeof args.payload["message"] === "string"
    ? (args.payload["message"] as string)
    : typeof args.payload["brief"] === "string"
      ? (args.payload["brief"] as string)
      : undefined;

  const properties: ContactProperties = {
    email: args.email,
    ...(firstname ? { firstname } : {}),
    ...(lastname ? { lastname } : {}),
    ...(args.company ? { company: args.company } : {}),
    ...(message ? { message } : {}),
    lifecyclestage: lifecycle,
    synozur_form_type: args.formType,
    synozur_marketing_opt_in: args.marketingOptIn ? "true" : "false",
    ...(args.utm.source ? { utm_source: args.utm.source } : {}),
    ...(args.utm.medium ? { utm_medium: args.utm.medium } : {}),
    ...(args.utm.campaign ? { utm_campaign: args.utm.campaign } : {}),
    ...(args.utm.term ? { utm_term: args.utm.term } : {}),
    ...(args.utm.content ? { utm_content: args.utm.content } : {}),
    ...(args.utm.landingPage ? { hs_analytics_first_url: args.utm.landingPage } : {}),
    ...(args.utm.referrer ? { hs_analytics_first_referrer: args.utm.referrer } : {}),
    ...(args.marketingOptIn ? { hs_legal_basis: "Consent" } : {}),
  };

  await db.insert(hubspotSyncEventsTable).values({
    kind: "contact.upsert",
    contactEmail: args.email,
    payload: {
      submissionId: args.submissionId,
      formType: args.formType,
      properties,
    },
  });

  // High-intent timeline event mirrors the form submission so sales sees the
  // raw signal even if a property update later overwrites the lifecycle stage.
  const timelineEventTemplate = {
    contact: "synozur_form_submitted",
    subscribe: "synozur_newsletter_subscribed",
    start: "synozur_get_started_submitted",
  }[args.formType];

  await db.insert(hubspotSyncEventsTable).values({
    kind: `timeline.${timelineEventTemplate}`,
    contactEmail: args.email,
    payload: {
      submissionId: args.submissionId,
      formType: args.formType,
      tokens: {
        form_type: args.formType,
        utm_source: args.utm.source ?? null,
        utm_medium: args.utm.medium ?? null,
        utm_campaign: args.utm.campaign ?? null,
        landing_page: args.utm.landingPage ?? null,
        marketing_opt_in: args.marketingOptIn,
      },
    },
  });
}

interface UpsertResponse {
  id?: string;
  message?: string;
}

async function callUpsertContact(
  token: string,
  properties: ContactProperties,
): Promise<{ ok: true; id: string } | { ok: false; error: string; retryable: boolean }> {
  // HubSpot exposes a `POST /crm/v3/objects/contacts/{email}?idProperty=email`
  // *update* path that 404s if the contact doesn't exist; create-then-update
  // is the documented idempotent pattern. We try the update first, then fall
  // back to a create if absent.
  try {
    const updateUrl = `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(properties.email)}?idProperty=email`;
    const updateRes = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });
    if (updateRes.ok) {
      const json = (await updateRes.json()) as UpsertResponse;
      return { ok: true, id: json.id ?? "" };
    }
    if (updateRes.status === 404) {
      const createUrl = `${HUBSPOT_API}/crm/v3/objects/contacts`;
      const createRes = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
      });
      if (createRes.ok) {
        const json = (await createRes.json()) as UpsertResponse;
        return { ok: true, id: json.id ?? "" };
      }
      const text = (await createRes.text()).slice(0, 500);
      return {
        ok: false,
        error: `create_${createRes.status}: ${text}`,
        retryable: createRes.status === 429 || createRes.status >= 500,
      };
    }
    const text = (await updateRes.text()).slice(0, 500);
    return {
      ok: false,
      error: `update_${updateRes.status}: ${text}`,
      retryable: updateRes.status === 429 || updateRes.status >= 500,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}

async function callTimelineEvent(
  token: string,
  appId: string,
  eventTemplateId: string,
  email: string,
  tokens: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; retryable: boolean }> {
  try {
    const url = `${HUBSPOT_API}/crm/v3/timeline/${encodeURIComponent(appId)}/events`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventTemplateId,
        email,
        tokens,
      }),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text()).slice(0, 500);
    return {
      ok: false,
      error: `timeline_${res.status}: ${text}`,
      retryable: res.status === 429 || res.status >= 500,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}

async function processOne(
  token: string,
  appId: string | null,
  row: typeof hubspotSyncEventsTable.$inferSelect,
): Promise<void> {
  const email = row.contactEmail;
  const payload = row.payload as Record<string, unknown>;
  if (!email) {
    await db
      .update(hubspotSyncEventsTable)
      .set({ status: "dead_letter", lastError: "missing_email" })
      .where(eq(hubspotSyncEventsTable.id, row.id));
    return;
  }

  if (row.kind === "contact.upsert") {
    const properties = (payload["properties"] ?? {}) as ContactProperties;
    const result = await callUpsertContact(token, properties);
    if (result.ok) {
      await db
        .update(hubspotSyncEventsTable)
        .set({
          status: "succeeded",
          succeededAt: new Date(),
          hubspotResourceId: result.id,
          attempts: row.attempts + 1,
        })
        .where(eq(hubspotSyncEventsTable.id, row.id));
      // Mirror back onto the form_submission for at-a-glance reporting.
      const submissionId = typeof payload["submissionId"] === "number"
        ? (payload["submissionId"] as number)
        : null;
      if (submissionId !== null) {
        await db
          .update(formSubmissionsTable)
          .set({ hubspotContactId: result.id, hubspotSyncStatus: "ok" })
          .where(eq(formSubmissionsTable.id, submissionId));
      }
      return;
    }
    await failOrDeadLetter(row, result.error, result.retryable);
    return;
  }

  if (row.kind.startsWith("timeline.")) {
    const eventTemplateId = row.kind.slice("timeline.".length);
    if (!appId) {
      // Without a registered app id we can't deliver timeline events; mark
      // skipped (terminal but not an error) so the queue stays clean.
      await db
        .update(hubspotSyncEventsTable)
        .set({ status: "skipped", lastError: "no_timeline_app_id" })
        .where(eq(hubspotSyncEventsTable.id, row.id));
      return;
    }
    const tokens = (payload["tokens"] ?? {}) as Record<string, unknown>;
    const result = await callTimelineEvent(token, appId, eventTemplateId, email, tokens);
    if (result.ok) {
      await db
        .update(hubspotSyncEventsTable)
        .set({
          status: "succeeded",
          succeededAt: new Date(),
          attempts: row.attempts + 1,
        })
        .where(eq(hubspotSyncEventsTable.id, row.id));
      return;
    }
    await failOrDeadLetter(row, result.error, result.retryable);
    return;
  }

  await db
    .update(hubspotSyncEventsTable)
    .set({ status: "dead_letter", lastError: `unknown_kind:${row.kind}` })
    .where(eq(hubspotSyncEventsTable.id, row.id));
}

async function failOrDeadLetter(
  row: typeof hubspotSyncEventsTable.$inferSelect,
  error: string,
  retryable: boolean,
): Promise<void> {
  const nextAttempts = row.attempts + 1;
  const terminal = !retryable || nextAttempts >= MAX_ATTEMPTS;
  await db
    .update(hubspotSyncEventsTable)
    .set({
      status: terminal ? "dead_letter" : "pending",
      attempts: nextAttempts,
      lastError: error,
      nextAttemptAt: terminal ? row.nextAttemptAt : nowPlus(backoffMs(nextAttempts)),
    })
    .where(eq(hubspotSyncEventsTable.id, row.id));
  if (terminal) {
    const submissionId = (row.payload as Record<string, unknown>)["submissionId"];
    if (typeof submissionId === "number") {
      await db
        .update(formSubmissionsTable)
        .set({ hubspotSyncStatus: "dead_letter", hubspotSyncError: error.slice(0, 500) })
        .where(eq(formSubmissionsTable.id, submissionId));
    }
  }
}

export async function drainHubspotQueue(limit = 25): Promise<{ processed: number }> {
  const token = process.env["HUBSPOT_ACCESS_TOKEN"];
  if (!token) return { processed: 0 };
  const settings = await loadSettings();
  if (!settings || settings.hubspotEnabled !== true) return { processed: 0 };

  // Atomic claim: select pending rows whose nextAttemptAt has passed and flip
  // them to in_flight in one go so concurrent workers don't double-deliver.
  // node-postgres can't do real `SELECT ... FOR UPDATE SKIP LOCKED` cleanly
  // through drizzle here, so we use a CTE-style update with returning.
  const claimed = await db.execute<{
    id: string;
    kind: string;
    contact_email: string | null;
    payload: unknown;
    attempts: number;
    next_attempt_at: Date;
  }>(sql`
    UPDATE hubspot_sync_events
    SET status = 'in_flight'
    WHERE id IN (
      SELECT id FROM hubspot_sync_events
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, contact_email, payload, attempts, next_attempt_at;
  `);

  const rows = (claimed as unknown as { rows?: Array<Record<string, unknown>> }).rows
    ?? (claimed as unknown as Array<Record<string, unknown>>);
  let processed = 0;
  for (const r of rows ?? []) {
    const row = {
      id: r["id"] as string,
      kind: r["kind"] as string,
      contactEmail: (r["contact_email"] ?? null) as string | null,
      payload: r["payload"],
      status: "in_flight" as const,
      attempts: Number(r["attempts"] ?? 0),
      lastError: null,
      hubspotResourceId: null,
      nextAttemptAt: r["next_attempt_at"] as Date,
      createdAt: new Date(),
      succeededAt: null,
    } as unknown as typeof hubspotSyncEventsTable.$inferSelect;
    try {
      await processOne(token, settings.hubspotTimelineAppId, row);
      processed += 1;
    } catch (err) {
      logger.warn({ err, eventId: row.id }, "HubSpot processOne threw");
      await failOrDeadLetter(row, err instanceof Error ? err.message : String(err), true);
    }
  }
  return { processed };
}

export async function replayDeadLetter(eventId: string): Promise<boolean> {
  const [row] = await db
    .update(hubspotSyncEventsTable)
    .set({ status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date() })
    .where(and(eq(hubspotSyncEventsTable.id, eventId), eq(hubspotSyncEventsTable.status, "dead_letter")))
    .returning();
  return !!row;
}

export async function queueDepth(): Promise<{ pending: number; deadLetter: number; succeeded: number }> {
  const rows = await db
    .select({
      status: hubspotSyncEventsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(hubspotSyncEventsTable)
    .groupBy(hubspotSyncEventsTable.status);
  let pending = 0;
  let deadLetter = 0;
  let succeeded = 0;
  for (const r of rows) {
    if (r.status === "pending" || r.status === "in_flight") pending += r.count;
    else if (r.status === "dead_letter") deadLetter += r.count;
    else if (r.status === "succeeded") succeeded += r.count;
  }
  return { pending, deadLetter, succeeded };
}

// #131: GDPR forget-me. HubSpot exposes a permanent-delete endpoint that
// tombstones the contact and prevents re-creation under the same email; we
// expose it through /admin/integrations/hubspot/erasure so legal can fulfill
// erasure requests without leaving the admin shell.
export async function eraseContact(email: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env["HUBSPOT_ACCESS_TOKEN"];
  if (!token) return { ok: false, error: "no_access_token" };
  try {
    const url = `${HUBSPOT_API}/crm/v3/objects/contacts/gdpr-delete`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idProperty: "email", objectId: email }),
    });
    if (res.ok || res.status === 204) return { ok: true };
    const text = (await res.text()).slice(0, 500);
    return { ok: false, error: `gdpr_${res.status}: ${text}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let workerHandle: NodeJS.Timeout | null = null;
let workerRunning = false;

export function startHubspotWorker(intervalMs = 30_000): void {
  if (workerHandle) return;
  workerHandle = setInterval(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await drainHubspotQueue(25);
    } catch (err) {
      logger.warn({ err }, "HubSpot worker tick failed");
    } finally {
      workerRunning = false;
    }
  }, intervalMs);
  // Allow the process to exit cleanly even with the worker registered.
  if (typeof workerHandle.unref === "function") workerHandle.unref();
  logger.info({ intervalMs }, "HubSpot sync worker started");
}

export function stopHubspotWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}

