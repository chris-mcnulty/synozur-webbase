import { and, eq, max, sql } from "drizzle-orm";
import { db, hubspotSyncEventsTable, siteSettingsTable, formSubmissionsTable, subscribersTable } from "@workspace/db";
import { logger } from "./logger";
import { ReplitConnectors } from "@replit/connectors-sdk";

// HubSpot API proxy via Replit Connectors SDK.
//
// The SDK handles OAuth token injection, refresh, and rotation automatically.
// We call all HubSpot endpoints through connectors.proxy() so we never need
// to extract or cache a raw token. Falls back to a static HUBSPOT_ACCESS_TOKEN
// env var for self-hosted / local dev (outside of Replit).

const REPLIT_CONNECTORS_AVAILABLE = !!process.env["REPLIT_CONNECTORS_HOSTNAME"];

interface SimpleInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

async function hubspotProxy(path: string, init: SimpleInit = {}): Promise<Response> {
  if (REPLIT_CONNECTORS_AVAILABLE) {
    const connectors = new ReplitConnectors();
    return connectors.proxy("hubspot", path, {
      method: init.method,
      body: init.body,
      headers: init.headers ?? {},
    }) as Promise<Response>;
  }
  // Static token fallback for local dev / self-hosted.
  const token = process.env["HUBSPOT_ACCESS_TOKEN"];
  if (!token) throw new Error("No HubSpot access token available");
  const headers: Record<string, string> = { ...(init.headers ?? {}), Authorization: `Bearer ${token}` };
  if (init.body) headers["Content-Type"] = "application/json";
  return fetch(`${HUBSPOT_API}${path}`, { method: init.method, body: init.body, headers });
}

export async function isHubspotConfigured(): Promise<boolean> {
  if (REPLIT_CONNECTORS_AVAILABLE) return true;
  return !!(process.env["HUBSPOT_ACCESS_TOKEN"]);
}

// Keep getHubspotAccessToken as a compat shim used by the admin status endpoint.
// It now only reports whether a token source is configured, not the actual token.
export async function getHubspotAccessToken(): Promise<string | null> {
  if (REPLIT_CONNECTORS_AVAILABLE) return "replit-connectors";
  const fromEnv = process.env["HUBSPOT_ACCESS_TOKEN"];
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

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
// 5 attempts ≈ ~45 minutes of backoff (5s/30s/2m/10m/30m) before a row
// transitions to dead_letter for admin review. Matches the spec on #131.
const MAX_ATTEMPTS = 5;

export type FormType =
  | "contact"
  | "subscribe"
  | "start"
  | "white-paper"
  | "webinar"
  | "partner"
  | "demo"
  | "event_registration";

export const ALL_FORM_TYPES: readonly FormType[] = [
  "contact",
  "subscribe",
  "start",
  "white-paper",
  "webinar",
  "partner",
  "demo",
  "event_registration",
];

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
  // HubSpot tracking cookie (`hubspotutk`). Stitches the contact to their
  // pre-form anonymous browsing behaviour for first-touch attribution.
  // Sent as a custom property because the v3 contact upsert endpoint
  // does not natively accept `hutk`; the HubSpot Forms API does, but we
  // use the CRM upsert path.
  synozur_hubspotutk?: string;
  // HubSpot built-in opt-out toggle. We mirror our own
  // `synozur_marketing_opt_in` onto it so list segmentation honours it.
  hs_email_optout?: "true" | "false";
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
  // Stable visitor identity — `hubspotutk` cookie value if HubSpot's
  // tracking pixel was loaded on the originating page. Lets HubSpot
  // stitch the resulting contact to their pre-form anonymous activity.
  hutk?: string | null;
  // Optional type-specific tokens merged into the timeline event payload
  // (e.g. white-paper title/slug, webinar starts_at, demo application
  // depth). Generic attribution tokens are always included; this is for
  // the contextual fields the timeline-event templates expect.
  timelineTokens?: Record<string, unknown>;
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
  if (formType === "start" || formType === "demo" || formType === "webinar") return "marketingqualifiedlead";
  if (formType === "partner") return "salesqualifiedlead";
  return "lead";
}

const TIMELINE_TEMPLATE_FOR_FORM: Record<FormType, string> = {
  contact: "synozur_form_submitted",
  subscribe: "synozur_newsletter_subscribed",
  start: "synozur_get_started_submitted",
  "white-paper": "synozur_white_paper_downloaded",
  webinar: "synozur_webinar_registered",
  partner: "synozur_form_submitted",
  demo: "synozur_application_demo_requested",
  event_registration: "synozur_event_registered",
};

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
    hs_email_optout: args.marketingOptIn ? "false" : "true",
    ...(args.hutk ? { synozur_hubspotutk: args.hutk } : {}),
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
  const timelineEventTemplate = TIMELINE_TEMPLATE_FOR_FORM[args.formType];

  if (!timelineEventTemplate) return;
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
        hutk: args.hutk ?? null,
        // Type-specific tokens (title, slug, starts_at, application,
        // depth, …) overlay the generic attribution tokens so the
        // timeline event reflects the actual action taken.
        ...(args.timelineTokens ?? {}),
      },
    },
  });
}

interface UpsertResponse {
  id?: string;
  message?: string;
}

async function callUpsertContact(
  properties: ContactProperties,
): Promise<{ ok: true; id: string } | { ok: false; error: string; retryable: boolean }> {
  // HubSpot exposes a PATCH /crm/v3/objects/contacts/{email}?idProperty=email
  // update path that 404s if the contact doesn't exist; create-then-update
  // is the documented idempotent pattern. We try the update first, then fall
  // back to a create if absent.
  try {
    const updateRes = await hubspotProxy(
      `/crm/v3/objects/contacts/${encodeURIComponent(properties.email)}?idProperty=email`,
      { method: "PATCH", body: JSON.stringify({ properties }) },
    );
    if (updateRes.ok) {
      const json = (await updateRes.json()) as UpsertResponse;
      return { ok: true, id: json.id ?? "" };
    }
    if (updateRes.status === 404) {
      const createRes = await hubspotProxy("/crm/v3/objects/contacts", {
        method: "POST",
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

// #131 — HubSpot Forms API submission used purely to stitch a contact's
// pre-form anonymous browsing history (`hubspotutk` cookie) to the
// contact record. Configured per form-type via env vars, e.g.
//   HUBSPOT_FORM_GUID_CONTACT=…
//   HUBSPOT_FORM_GUID_WHITE_PAPER=…
// plus HUBSPOT_PORTAL_ID. Without those, this is a no-op — we still
// upsert the contact via the CRM API, just without identity stitching.
function formGuidFor(formType: string): string | null {
  const key = `HUBSPOT_FORM_GUID_${formType.toUpperCase().replace(/-/g, "_")}`;
  const v = process.env[key];
  return v && v.length > 0 ? v : null;
}

async function submitFormForStitching(
  formType: string,
  properties: ContactProperties,
  hutk: string,
): Promise<void> {
  const formGuid = formGuidFor(formType);
  const portalId = process.env["HUBSPOT_PORTAL_ID"];
  if (!formGuid || !portalId) return;
  const fields: Array<{ name: string; value: string }> = [
    { name: "email", value: properties.email },
  ];
  if (properties.firstname) fields.push({ name: "firstname", value: properties.firstname });
  if (properties.lastname) fields.push({ name: "lastname", value: properties.lastname });
  if (properties.company) fields.push({ name: "company", value: properties.company });
  const body = {
    fields,
    context: { hutk, pageUri: properties.hs_analytics_first_url ?? undefined },
  };
  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formGuid)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`hsforms_${res.status}: ${text}`);
  }
}

// HubSpot's timeline-event API requires the numeric template *id* in
// the `eventTemplateId` field, not the template name. Bootstrap creates
// templates by name (e.g. `synozur_white_paper_downloaded`); we resolve
// the name→id mapping at first use and cache it in-process. The cache
// is invalidated on a 404 so a freshly-bootstrapped template is picked
// up without a server restart.
let timelineTemplateIdCache: Map<string, string> | null = null;
async function resolveTimelineTemplateId(
  appId: string,
  templateName: string,
): Promise<string | null> {
  if (timelineTemplateIdCache?.has(templateName)) {
    return timelineTemplateIdCache.get(templateName) ?? null;
  }
  const res = await hubspotProxy(`/crm/v3/timeline/${encodeURIComponent(appId)}/event-templates`);
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: Array<{ id?: string; name?: string }> };
  const map = new Map<string, string>();
  for (const t of json.results ?? []) {
    if (t.name && t.id) map.set(t.name, t.id);
  }
  timelineTemplateIdCache = map;
  return map.get(templateName) ?? null;
}

async function callTimelineEvent(
  appId: string,
  templateName: string,
  email: string,
  tokens: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; retryable: boolean }> {
  try {
    const eventTemplateId = await resolveTimelineTemplateId(appId, templateName);
    if (!eventTemplateId) {
      return {
        ok: false,
        error: `timeline_template_not_found: ${templateName}`,
        retryable: false,
      };
    }
    const res = await hubspotProxy(
      `/crm/v3/timeline/${encodeURIComponent(appId)}/events`,
      {
        method: "POST",
        body: JSON.stringify({ eventTemplateId, email, tokens }),
      },
    );
    // A 404 here usually means the cached template id was wiped on the
    // portal; bust the cache so the next call re-discovers it.
    if (res.status === 404) timelineTemplateIdCache = null;
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
    // #131 — When the form handler captured a `hubspotutk` cookie, we
    // also submit through the HubSpot Forms API (when a form GUID is
    // configured) so HubSpot stitches anonymous browsing/session
    // history to the resulting contact. The contact upsert below is
    // still authoritative for properties; the form submission's role
    // is purely identity stitching, so failures are logged but never
    // dead-letter the row.
    const formType = typeof payload["formType"] === "string" ? (payload["formType"] as string) : null;
    const hutk = typeof properties.synozur_hubspotutk === "string" && properties.synozur_hubspotutk.length > 0
      ? properties.synozur_hubspotutk
      : null;
    if (formType && hutk) {
      try {
        await submitFormForStitching(formType, properties, hutk);
      } catch (err) {
        logger.warn({ err, formType }, "HubSpot Forms API stitching failed (non-fatal)");
      }
    }
    const result = await callUpsertContact(properties);
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
    const result = await callTimelineEvent(appId, eventTemplateId, email, tokens);
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
  const configured = await isHubspotConfigured();
  if (!configured) return { processed: 0 };
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
      await processOne(settings.hubspotTimelineAppId, row);
      processed += 1;
    } catch (err) {
      logger.warn({ err, eventId: row.id }, "HubSpot processOne threw");
      await failOrDeadLetter(row, err instanceof Error ? err.message : String(err), true);
    }
  }
  return { processed };
}

// #131 — Local→HubSpot subscription mirroring. Called from the
// /forms/subscribe/unsubscribe route (and any future preference centre)
// so a local opt-out is durably propagated to HubSpot through the same
// queue + retry machinery that contact upserts ride. We enqueue a
// `contact.upsert` that flips both our custom `synozur_marketing_opt_in`
// flag and HubSpot's built-in `hs_email_optout` so list segmentation and
// transactional gating both honour it.
export async function enqueueSubscriptionUpdate(args: {
  email: string;
  subscribed: boolean;
  reason?: string;
}): Promise<void> {
  const settings = await loadSettings();
  if (!settings || settings.hubspotEnabled !== true) return;
  await db.insert(hubspotSyncEventsTable).values({
    kind: "contact.upsert",
    contactEmail: args.email,
    payload: {
      properties: {
        email: args.email,
        synozur_marketing_opt_in: args.subscribed ? "true" : "false",
        hs_email_optout: args.subscribed ? "false" : "true",
        ...(args.reason ? { hs_legal_basis: args.reason } : {}),
      },
      reason: args.reason ?? "subscription_change",
    },
  });
}

// #131 — Deterministic mapping from a stored submission payload to the
// type-specific timeline-event tokens HubSpot expects. Lives here (not
// the form handlers) so live submits, the backlog migration, and admin
// force-resync all produce the *same* tokens for the same row. If a
// caller wants to override (e.g. start handler trims `brief`), it can
// pass `timelineTokens` to `enqueueContactSubmission`, which take
// precedence over these computed defaults.
export function computeTimelineTokens(
  formType: FormType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const str = (k: string): string | null =>
    typeof payload[k] === "string" ? (payload[k] as string) : null;
  switch (formType) {
    case "white-paper":
      return { title: str("title"), slug: str("slug") };
    case "webinar":
      return { title: str("title"), slug: str("slug"), starts_at: str("startsAt") };
    case "partner":
      return { partner_type: str("partnerType"), application: str("application") };
    case "demo":
      return { depth: str("depth"), application: str("application") };
    case "start":
      return {
        brief: str("brief")?.slice(0, 200) ?? null,
        timeline: str("timeline"),
        budget: str("budget"),
      };
    case "event_registration":
      return {
        event_title: str("eventTitle"),
        event_slug: str("eventSlug"),
        company: str("company"),
        job_title: str("jobTitle"),
      };
    case "contact":
    case "subscribe":
    default:
      return {};
  }
}

// Force a re-sync of a single previously-synced form submission.
// Re-enqueues a fresh `contact.upsert` AND the matching timeline event
// from the persisted submission row, so admins can recover from a
// transient HubSpot misconfiguration without re-running the full
// backfill script. Going through `enqueueContactSubmission` keeps the
// resync semantically identical to a fresh form submit.
export async function forceResyncSubmission(submissionId: number): Promise<boolean> {
  const row = await db.query.formSubmissionsTable.findFirst({
    where: eq(formSubmissionsTable.id, submissionId),
  });
  if (!row || !row.email) return false;
  const formType = (ALL_FORM_TYPES as readonly string[]).includes(row.formType)
    ? (row.formType as FormType)
    : "contact";
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  // hutk is persisted under the live cookie name (`hubspotutk`) by the
  // form handlers; older rows may have stored it as `hutk`.
  const hutk = typeof payload["hubspotutk"] === "string"
    ? (payload["hubspotutk"] as string)
    : typeof payload["hutk"] === "string"
      ? (payload["hutk"] as string)
      : null;
  // Recompute the timeline tokens from the persisted payload so backfill
  // and resync produce the same timeline event a fresh submit would.
  const timelineTokens = computeTimelineTokens(formType, payload);
  await enqueueContactSubmission({
    formType,
    submissionId: row.id,
    email: row.email,
    name: row.name ?? null,
    company: row.company ?? null,
    marketingOptIn: row.marketingOptIn ?? false,
    payload,
    utm: {
      source: row.utmSource,
      medium: row.utmMedium,
      campaign: row.utmCampaign,
      term: row.utmTerm,
      content: row.utmContent,
      landingPage: row.landingPage,
      referrer: row.referrer,
    },
    hutk,
    timelineTokens,
  });
  await db
    .update(formSubmissionsTable)
    .set({ hubspotSyncStatus: "queued", hubspotSyncError: null })
    .where(eq(formSubmissionsTable.id, submissionId));
  return true;
}

// Per-form-type and per-status last-sync timestamps. Powers the admin
// health dashboard's "last contact synced", "last timeline event sent",
// and per-form-type freshness indicators.
export async function lastSyncTimestamps(): Promise<{
  lastContactUpsert: Date | null;
  lastTimelineEvent: Date | null;
  lastDeadLetter: Date | null;
  perFormType: Record<string, Date | null>;
}> {
  const [contact] = await db
    .select({ at: max(hubspotSyncEventsTable.succeededAt) })
    .from(hubspotSyncEventsTable)
    .where(and(eq(hubspotSyncEventsTable.kind, "contact.upsert"), eq(hubspotSyncEventsTable.status, "succeeded")));
  const [timeline] = await db
    .select({ at: max(hubspotSyncEventsTable.succeededAt) })
    .from(hubspotSyncEventsTable)
    .where(
      and(
        sql`kind LIKE 'timeline.%'`,
        eq(hubspotSyncEventsTable.status, "succeeded"),
      ),
    );
  const [deadLetter] = await db
    .select({ at: max(hubspotSyncEventsTable.createdAt) })
    .from(hubspotSyncEventsTable)
    .where(eq(hubspotSyncEventsTable.status, "dead_letter"));
  // Per-form-type freshness is derived from the sync queue itself — the
  // last `succeeded_at` of a contact-upsert event whose persisted
  // payload carries that formType. Driving this off
  // `form_submissions.created_at` would conflate submission time with
  // sync time and report stale data after a backfill or a long worker
  // outage.
  const perFormRows = await db
    .select({
      formType: sql<string>`payload->>'formType'`,
      at: max(hubspotSyncEventsTable.succeededAt),
    })
    .from(hubspotSyncEventsTable)
    .where(
      and(
        eq(hubspotSyncEventsTable.kind, "contact.upsert"),
        eq(hubspotSyncEventsTable.status, "succeeded"),
        sql`payload->>'formType' IS NOT NULL`,
      ),
    )
    .groupBy(sql`payload->>'formType'`);
  const perFormType: Record<string, Date | null> = {};
  for (const ft of ALL_FORM_TYPES) perFormType[ft] = null;
  for (const r of perFormRows) {
    if (r.formType) perFormType[r.formType] = r.at ?? null;
  }
  return {
    lastContactUpsert: contact?.at ?? null,
    lastTimelineEvent: timeline?.at ?? null,
    lastDeadLetter: deadLetter?.at ?? null,
    perFormType,
  };
}

// Lightweight live connection probe — calls the HubSpot account-info
// endpoint and reports whether the configured token is currently
// authorized. Used by the admin health page so operators can tell at a
// glance whether the integration is live without inspecting the queue.
export async function probeHubspotConnection(): Promise<{ ok: boolean; portalId?: number; error?: string }> {
  if (!(await isHubspotConfigured())) return { ok: false, error: "no_access_token" };
  try {
    const res = await hubspotProxy("/account-info/v3/details");
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return { ok: false, error: `account_info_${res.status}: ${text}` };
    }
    const json = (await res.json()) as { portalId?: number };
    return { ok: true, portalId: json.portalId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Look up a contact's email address by HubSpot internal id. Used by the
// inbound webhook handler when HubSpot delivers an objectId-only CRM
// event (common for subscription / property-change webhooks) so we can
// still mirror the change onto the canonical `subscribers` row.
export async function resolveContactEmailById(objectId: string): Promise<string | null> {
  if (!(await isHubspotConfigured())) return null;
  const res = await hubspotProxy(
    `/crm/v3/objects/contacts/${encodeURIComponent(objectId)}?properties=email`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { properties?: { email?: string | null } };
  const email = json.properties?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
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
  const configured = await isHubspotConfigured();
  if (!configured) return { ok: false, error: "no_access_token" };
  try {
    const res = await hubspotProxy("/crm/v3/objects/contacts/gdpr-delete", {
      method: "POST",
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

// #131 — Run on api-server startup to guarantee the portal is bootstrapped
// (custom contact properties + timeline event templates) and that any
// pre-existing form_submissions rows are enqueued for sync. Both phases
// are idempotent: bootstrap PUTs/POSTs are skipped when an existing
// definition matches, and the migration only enqueues rows whose
// `hubspotSyncStatus IS NULL`. Gated on `hubspotEnabled` so dev portals
// without a token noop. Errors are logged but never crash the server.
export async function bootstrapHubspotOnStartup(): Promise<void> {
  try {
    if (!(await isHubspotConfigured())) return;
    const settings = await loadSettings();
    if (!settings || settings.hubspotEnabled !== true) return;
    const { runHubspotBootstrap } = await import("../scripts/bootstrapHubspotProperties");
    const { runHubspotBacklogMigration } = await import("../scripts/migrateSubmissionsToHubspot");
    await runHubspotBootstrap({ apply: true });
    await runHubspotBacklogMigration({ apply: true, closePool: false });
    logger.info("HubSpot startup bootstrap + backlog migration complete");
  } catch (err) {
    logger.warn({ err }, "HubSpot startup bootstrap failed (non-fatal)");
  }
}

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

