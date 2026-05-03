import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, ilike, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  SubmitContactBody,
  SubmitSubscribeBody,
  SubmitStartBody,
  SubmitContactResponse,
  ListAdminFormSubmissionsQueryParams,
  ListAdminFormSubmissionsResponse,
  ExportAdminFormSubmissionsQueryParams,
  RetryAdminFormSubmissionParams,
  RetryAdminFormSubmissionResponse,
  RetryFailedAdminFormSubmissionsQueryParams,
  RetryFailedAdminFormSubmissionsResponse,
} from "@workspace/api-zod";
import {
  db,
  formSubmissionsTable,
  siteSettingsTable,
  subscribersTable,
  type FormSubmission,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";
import {
  sendVisitorConfirmation,
  sendInternalNotification,
  sendSubscriptionConfirmation,
} from "../lib/email";
import { verifyTurnstile } from "../lib/turnstile";
import { enqueueContactSubmission, type FormType } from "../lib/hubspotSync";
import {
  signSubscriberConfirmToken,
  verifySubscriberConfirmToken,
  hashToken,
  signSubscriberUnsubscribeToken,
  verifySubscriberUnsubscribeToken,
} from "../lib/subscriberToken";
import { siteOrigin } from "../lib/siteOrigin";

const router: IRouter = Router();

const WEBHOOK_URL = process.env["FORMS_WEBHOOK_URL"] ?? "";

// #131: marketing-opt-in + first-touch attribution. The schemas regenerate
// from openapi.yaml don't yet carry these fields, so we extend with passthrough
// here. Older clients that don't supply them remain valid.
const MarketingExtension = z.object({
  marketingOptIn: z.boolean().nullish(),
  utmSource: z.string().max(200).nullish(),
  utmMedium: z.string().max(200).nullish(),
  utmCampaign: z.string().max(200).nullish(),
  utmTerm: z.string().max(200).nullish(),
  utmContent: z.string().max(200).nullish(),
  landingPage: z.string().max(2048).nullish(),
  referrer: z.string().max(2048).nullish(),
});

const ContactBodyExt = SubmitContactBody.and(MarketingExtension);
const SubscribeBodyExt = SubmitSubscribeBody.and(MarketingExtension);
const StartBodyExt = SubmitStartBody.and(MarketingExtension);

interface AttributionFields {
  marketingOptIn: boolean;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
    landingPage: string | null;
    referrer: string | null;
  };
}

async function resolveAttribution(
  formType: FormType,
  body: z.infer<typeof MarketingExtension>,
): Promise<AttributionFields> {
  // EU-default opt-out is implemented as a server-side default flip when no
  // explicit choice was made by the client. In Phase 1 we use a single global
  // `hubspotEuOptInDefault` flag in site settings; geo-based defaults are a
  // follow-up once we add a geo lookup.
  let optIn = body.marketingOptIn ?? null;
  if (optIn === null) {
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, 1),
    });
    optIn = settings?.hubspotEuOptInDefault === true ? false : true;
  }
  // Newsletter subscribe is itself an explicit opt-in even if the client didn't
  // toggle the flag — treat it as consent.
  if (formType === "subscribe") optIn = true;
  return {
    marketingOptIn: optIn,
    utm: {
      source: body.utmSource ?? null,
      medium: body.utmMedium ?? null,
      campaign: body.utmCampaign ?? null,
      term: body.utmTerm ?? null,
      content: body.utmContent ?? null,
      landingPage: body.landingPage ?? null,
      referrer: body.referrer ?? null,
    },
  };
}

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 1000) : null;
}

interface ForwardResult {
  status: string;
  error: string | null;
}

async function forwardToWebhook(payload: unknown): Promise<ForwardResult> {
  if (!WEBHOOK_URL) return { status: "skipped", error: null };
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      return { status: `error_${res.status}`, error: text };
    }
    return { status: "ok", error: null };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

interface PersistArgs {
  formType: string;
  email: string | null;
  name: string | null;
  company: string | null;
  payload: Record<string, unknown>;
  req: Request;
  webhook: ForwardResult;
  attribution?: AttributionFields | null;
}

async function sendEmails(args: {
  formType: "contact" | "subscribe" | "start";
  submissionId: number;
  email: string | null;
  name: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  if (args.email) {
    tasks.push(
      sendVisitorConfirmation(args.formType, args.email, args.name).then((r) => {
        if (r.status === "error") {
          logger.warn(
            { submissionId: args.submissionId, formType: args.formType, error: r.error },
            "Visitor confirmation email failed",
          );
        }
      }),
    );
  }
  tasks.push(
    sendInternalNotification(args).then((r) => {
      if (r.status === "error") {
        logger.warn(
          { submissionId: args.submissionId, formType: args.formType, error: r.error },
          "Internal notification email failed",
        );
      }
    }),
  );
  try {
    await Promise.all(tasks);
  } catch (err) {
    logger.warn({ err }, "Email dispatch threw");
  }
}

async function persist(args: PersistArgs): Promise<number> {
  const attr = args.attribution;
  const [row] = await db
    .insert(formSubmissionsTable)
    .values({
      formType: args.formType,
      email: args.email,
      name: args.name,
      company: args.company,
      payload: args.payload,
      ipAddress: clientIp(args.req),
      userAgent: userAgent(args.req),
      webhookStatus: args.webhook.status,
      webhookError: args.webhook.error,
      marketingOptIn: attr?.marketingOptIn ?? null,
      utmSource: attr?.utm.source ?? null,
      utmMedium: attr?.utm.medium ?? null,
      utmCampaign: attr?.utm.campaign ?? null,
      utmTerm: attr?.utm.term ?? null,
      utmContent: attr?.utm.content ?? null,
      landingPage: attr?.utm.landingPage ?? null,
      referrer: attr?.utm.referrer ?? null,
      hubspotSyncStatus: null,
    })
    .returning({ id: formSubmissionsTable.id });
  return row!.id;
}

function buildSubmissionFilter(formType?: string, search?: string): SQL | undefined {
  const conditions: SQL[] = [];
  if (formType && formType.length > 0) {
    conditions.push(eq(formSubmissionsTable.formType, formType));
  }
  if (search && search.trim().length > 0) {
    const needle = `%${search.trim()}%`;
    const orClause = or(
      ilike(formSubmissionsTable.email, needle),
      ilike(formSubmissionsTable.name, needle),
      ilike(formSubmissionsTable.company, needle),
    );
    if (orClause) conditions.push(orClause);
  }
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

function adminSubmissionShape(row: FormSubmission) {
  return {
    id: row.id,
    formType: row.formType,
    email: row.email,
    name: row.name,
    company: row.company,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    webhookStatus: row.webhookStatus,
    webhookError: row.webhookError,
    createdAt: row.createdAt,
  };
}

router.post(
  "/admin/forms/submissions/:id/resend-webhook",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid submission id" });
      return;
    }
    const [row] = await db
      .select()
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const webhook = await forwardToWebhook({ formType: row.formType, ...payload });
    const [updated] = await db
      .update(formSubmissionsTable)
      .set({ webhookStatus: webhook.status, webhookError: webhook.error })
      .where(eq(formSubmissionsTable.id, id))
      .returning();
    res.json(adminSubmissionShape(updated!));
  },
);

router.get("/admin/forms/submissions", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListAdminFormSubmissionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 25;
  const where = buildSubmissionFilter(parsed.data.formType, parsed.data.search);

  const baseQuery = db.select().from(formSubmissionsTable);
  const filtered = where ? baseQuery.where(where) : baseQuery;
  const rows = await filtered
    .orderBy(desc(formSubmissionsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(formSubmissionsTable);
  const totalRows = where ? await countQuery.where(where) : await countQuery;
  const total = totalRows[0]?.count ?? 0;

  res.json(
    ListAdminFormSubmissionsResponse.parse({
      items: rows.map(adminSubmissionShape),
      total,
      page,
      pageSize,
    }),
  );
});

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = typeof value === "string" ? value : JSON.stringify(value);
  // Neutralize spreadsheet formula injection: cells starting with =, +, -, @
  // (and tab/CR which some apps treat as formula leaders) are prefixed with
  // a leading apostrophe so Excel/Sheets render them as text.
  if (str.length > 0 && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

router.get("/admin/forms/submissions.csv", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ExportAdminFormSubmissionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const where = buildSubmissionFilter(parsed.data.formType, parsed.data.search);
  const baseQuery = db.select().from(formSubmissionsTable);
  const filtered = where ? baseQuery.where(where) : baseQuery;
  const rows = await filtered.orderBy(desc(formSubmissionsTable.createdAt));

  const header = [
    "id",
    "createdAt",
    "formType",
    "name",
    "email",
    "company",
    "ipAddress",
    "webhookStatus",
    "webhookError",
    "payload",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        row.formType,
        row.name,
        row.email,
        row.company,
        row.ipAddress,
        row.webhookStatus,
        row.webhookError,
        row.payload,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const filename = `form-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n") + "\n");
});

function buildRetryPayload(row: FormSubmission): Record<string, unknown> {
  const stored = (row.payload ?? {}) as Record<string, unknown>;
  return { ...stored, formType: row.formType };
}

router.post(
  "/admin/forms/submissions/:id/retry",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = RetryAdminFormSubmissionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const id = parsed.data.id;
    const [row] = await db
      .select()
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    const result = await forwardToWebhook(buildRetryPayload(row));
    const [updated] = await db
      .update(formSubmissionsTable)
      .set({ webhookStatus: result.status, webhookError: result.error })
      .where(eq(formSubmissionsTable.id, id))
      .returning();
    res.json(RetryAdminFormSubmissionResponse.parse(adminSubmissionShape(updated!)));
  },
);

router.post(
  "/admin/forms/submissions/retry-failed",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = RetryFailedAdminFormSubmissionsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const filter = buildSubmissionFilter(parsed.data.formType, parsed.data.search);
    const failedClause = or(
      isNull(formSubmissionsTable.webhookStatus),
      notInArray(formSubmissionsTable.webhookStatus, ["ok", "skipped"]),
    )!;
    const where = filter ? and(filter, failedClause) : failedClause;

    const rows = await db.select().from(formSubmissionsTable).where(where);
    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await forwardToWebhook(buildRetryPayload(row));
      await db
        .update(formSubmissionsTable)
        .set({ webhookStatus: result.status, webhookError: result.error })
        .where(eq(formSubmissionsTable.id, row.id));
      if (result.status === "ok" || result.status === "skipped") {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }
    res.json(
      RetryFailedAdminFormSubmissionsResponse.parse({
        retried: rows.length,
        succeeded,
        failed,
      }),
    );
  },
);

router.post("/forms/contact", async (req, res): Promise<void> => {
  const parsed = ContactBodyExt.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.website && data.website.trim() !== "") {
    res.json(SubmitContactResponse.parse({ ok: true, id: 0 }));
    return;
  }
  const ip = clientIp(req);
  if (!(await verifyTurnstile(data.turnstileToken, ip))) {
    res.status(400).json({ error: "Bot check failed. Please reload and try again.", code: "bot_check_failed" });
    return;
  }
  const {
    turnstileToken: _t,
    website: _w,
    marketingOptIn: _m,
    utmSource: _us,
    utmMedium: _um,
    utmCampaign: _uc,
    utmTerm: _ut,
    utmContent: _uct,
    landingPage: _lp,
    referrer: _ref,
    ...payload
  } = data;
  const attribution = await resolveAttribution("contact", data);
  const webhook = await forwardToWebhook({ formType: "contact", ...payload });
  const id = await persist({
    formType: "contact",
    email: payload.email,
    name: payload.name,
    company: payload.company,
    payload,
    req,
    webhook,
    attribution,
  });
  void sendEmails({
    formType: "contact",
    submissionId: id,
    email: payload.email,
    name: payload.name,
    payload,
  });
  void enqueueContactSubmission({
    formType: "contact",
    submissionId: id,
    email: payload.email,
    name: payload.name,
    company: payload.company,
    marketingOptIn: attribution.marketingOptIn,
    payload,
    utm: attribution.utm,
  }).catch((err) => logger.warn({ err, id }, "HubSpot enqueue failed (contact)"));
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

// #259 — Double opt-in. /forms/subscribe creates a `pending` row in the
// `subscribers` table and emails a signed confirmation link. We deliberately
// do NOT enqueue the HubSpot upsert or send the welcome email here — both
// happen on confirm, so a bot or competitor cannot poison our HubSpot
// contact list or trigger marketing sends to addresses we cannot prove the
// recipient owns.
async function buildConfirmUrl(token: string): Promise<string> {
  return `${siteOrigin()}/api/forms/subscribe/confirm?token=${encodeURIComponent(token)}`;
}

router.post("/forms/subscribe", async (req, res): Promise<void> => {
  const parsed = SubscribeBodyExt.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.website && data.website.trim() !== "") {
    res.json(SubmitContactResponse.parse({ ok: true, id: 0 }));
    return;
  }
  const ip = clientIp(req);
  if (!(await verifyTurnstile(data.turnstileToken, ip))) {
    res
      .status(400)
      .json({ error: "Bot check failed. Please reload and try again.", code: "bot_check_failed" });
    return;
  }
  const {
    turnstileToken: _t,
    website: _w,
    marketingOptIn: _m,
    utmSource: _us,
    utmMedium: _um,
    utmCampaign: _uc,
    utmTerm: _ut,
    utmContent: _uct,
    landingPage: _lp,
    referrer: _ref,
    ...payload
  } = data;
  const email = payload.email.trim().toLowerCase();
  const attribution = await resolveAttribution("subscribe", data);
  const webhook = await forwardToWebhook({ formType: "subscribe", ...payload });

  // Always log the form submission for audit/attribution; it stays the
  // canonical record of "someone hit the endpoint", separate from
  // confirmed-subscriber state.
  const submissionId = await persist({
    formType: "subscribe",
    email,
    name: null,
    company: null,
    payload,
    req,
    webhook,
    attribution,
  });

  const source = typeof payload["source"] === "string" ? (payload["source"] as string) : null;
  const submittedIp = clientIp(req);
  const submittedUa = userAgent(req);
  const now = new Date();

  // Find or create the subscriber row.
  const existing = await db.query.subscribersTable.findFirst({
    where: eq(subscribersTable.email, email),
  });

  let subscriberId: number;
  let shouldSendConfirmation = false;
  if (!existing) {
    const [row] = await db
      .insert(subscribersTable)
      .values({
        email,
        status: "pending",
        source,
        submittedIp,
        submittedUserAgent: submittedUa,
      })
      .returning({ id: subscribersTable.id });
    subscriberId = row!.id;
    shouldSendConfirmation = true;
  } else if (existing.status === "confirmed") {
    // Already confirmed — no-op (#259: "resubmission while confirmed is a no-op").
    res.json(SubmitContactResponse.parse({ ok: true, id: submissionId }));
    return;
  } else {
    // Pending or unsubscribed: rotate token and (re)send confirmation,
    // bringing an unsubscribed address back into the pending state.
    subscriberId = existing.id;
    shouldSendConfirmation = true;
  }

  if (shouldSendConfirmation) {
    const { token, hash } = signSubscriberConfirmToken(subscriberId);
    await db
      .update(subscribersTable)
      .set({
        status: "pending",
        confirmationTokenHash: hash,
        confirmationSentAt: now,
        unsubscribedAt: null,
        ...(source ? { source } : {}),
        submittedIp,
        submittedUserAgent: submittedUa,
      })
      .where(eq(subscribersTable.id, subscriberId));
    const confirmUrl = await buildConfirmUrl(token);
    void sendSubscriptionConfirmation({ to: email, confirmUrl }).then((r) => {
      if (r.status === "error") {
        logger.warn(
          { subscriberId, submissionId, error: r.error },
          "DOI confirmation email failed",
        );
      }
    });
  }

  // Internal notification still fires (so sales sees the raw signal); the
  // visitor-facing welcome email is gated on confirm.
  void sendInternalNotification({
    formType: "subscribe",
    submissionId,
    email,
    name: null,
    payload,
  }).then((r) => {
    if (r.status === "error") {
      logger.warn(
        { submissionId, error: r.error },
        "Internal notification email failed (subscribe)",
      );
    }
  });

  res.json(SubmitContactResponse.parse({ ok: true, id: submissionId }));
});

// #259 — DOI confirmation landing.
// Validates the signed token, enforces the 7-day TTL, requires the stored
// hash to match (so revoked tokens stop working), flips status to
// `confirmed`, records the confirming IP/UA, and only then enqueues the
// HubSpot upsert + welcome marketing send. Renders an HTML success page
// with a one-click unsubscribe link.
function renderConfirmPage(opts: {
  ok: boolean;
  title: string;
  body: string;
  unsubscribeUrl?: string;
}): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const unsubLink = opts.unsubscribeUrl
    ? `<p style="margin-top:32px;font-size:13px;color:#9999aa;">Changed your mind? <a href="${escape(opts.unsubscribeUrl)}" style="color:#9999aa;">Unsubscribe</a></p>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escape(opts.title)} — The Synozur Alliance</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0b1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a2e;min-height:100vh;">
    <div style="max-width:560px;margin:64px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.25);">
      <div style="background:linear-gradient(135deg,#810FFB 0%,#3a0ca3 100%);padding:28px 32px;color:#ffffff;">
        <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;">The Synozur Alliance</div>
        <div style="margin-top:6px;font-size:22px;font-weight:600;line-height:1.25;">${escape(opts.title)}</div>
      </div>
      <div style="padding:28px 32px;font-size:15px;line-height:1.6;color:#1a1a2e;">
        <p style="margin:0 0 16px;">${opts.body}</p>
        <p style="margin:24px 0 0;"><a href="${escape(siteOrigin())}" style="color:#810FFB;font-weight:600;text-decoration:none;">Return to ${escape(siteOrigin().replace(/^https?:\/\//, ""))} →</a></p>
        ${unsubLink}
      </div>
    </div>
  </body>
</html>`;
}

router.get("/forms/subscribe/confirm", async (req, res): Promise<void> => {
  const token = typeof req.query["token"] === "string" ? req.query["token"] : null;
  const payload = verifySubscriberConfirmToken(token);
  if (!payload || !token) {
    res.status(400).type("html").send(
      renderConfirmPage({
        ok: false,
        title: "Confirmation link invalid or expired",
        body:
          "This confirmation link is invalid or has expired. Please subscribe again from the site to receive a new confirmation email.",
      }),
    );
    return;
  }
  const row = await db.query.subscribersTable.findFirst({
    where: eq(subscribersTable.id, payload.subscriberId),
  });
  if (!row) {
    res.status(404).type("html").send(
      renderConfirmPage({
        ok: false,
        title: "Confirmation link invalid",
        body: "We couldn't find a matching subscription. Please subscribe again from the site.",
      }),
    );
    return;
  }
  // Already confirmed — render the same success page (idempotent).
  if (row.status === "confirmed") {
    res.type("html").send(
      renderConfirmPage({
        ok: true,
        title: "You're already confirmed",
        body: `<strong>${row.email}</strong> is already confirmed for Synozur Alliance insights — thanks for subscribing.`,
      }),
    );
    return;
  }
  // Verify hash matches the active token (revoked tokens must fail even if
  // the signature still verifies).
  const incomingHash = hashToken(token);
  if (!row.confirmationTokenHash || row.confirmationTokenHash !== incomingHash) {
    res.status(400).type("html").send(
      renderConfirmPage({
        ok: false,
        title: "Confirmation link superseded",
        body:
          "This confirmation link has been replaced by a newer one. Please use the most recent confirmation email we sent you, or subscribe again to receive a fresh link.",
      }),
    );
    return;
  }

  const now = new Date();
  await db
    .update(subscribersTable)
    .set({
      status: "confirmed",
      confirmedAt: now,
      confirmedIp: clientIp(req),
      confirmedUserAgent: userAgent(req),
      confirmationTokenHash: null,
      unsubscribedAt: null,
    })
    .where(eq(subscribersTable.id, row.id));

  // Now — and only now — enqueue the HubSpot upsert and send the welcome
  // marketing email. Failures here are logged but do not turn the user-facing
  // confirmation into an error; the row is already confirmed.
  //
  // Carry first-touch attribution forward from the original /forms/subscribe
  // row so HubSpot doesn't lose UTM/landing/referrer just because the contact
  // confirmed on a different device or hours later. The most-recent
  // form_submissions row for this email + formType=subscribe is the canonical
  // source — that's what /forms/subscribe wrote at submit time.
  const originalSubmission = await db.query.formSubmissionsTable.findFirst({
    where: and(
      eq(formSubmissionsTable.email, row.email),
      eq(formSubmissionsTable.formType, "subscribe"),
    ),
    orderBy: [desc(formSubmissionsTable.createdAt)],
  });
  void sendVisitorConfirmation("subscribe", row.email, null).then((r) => {
    if (r.status === "error") {
      logger.warn(
        { subscriberId: row.id, error: r.error },
        "Welcome subscribe email failed after DOI confirm",
      );
    }
  });
  void enqueueContactSubmission({
    formType: "subscribe",
    submissionId: originalSubmission?.id ?? 0,
    email: row.email,
    name: null,
    company: null,
    marketingOptIn: true,
    payload: {
      email: row.email,
      source: row.source ?? "subscribe",
      doiConfirmed: true,
      ...(originalSubmission?.payload && typeof originalSubmission.payload === "object"
        ? (originalSubmission.payload as Record<string, unknown>)
        : {}),
    },
    utm: {
      source: originalSubmission?.utmSource ?? null,
      medium: originalSubmission?.utmMedium ?? null,
      campaign: originalSubmission?.utmCampaign ?? null,
      term: originalSubmission?.utmTerm ?? null,
      content: originalSubmission?.utmContent ?? null,
      landingPage: originalSubmission?.landingPage ?? null,
      referrer: originalSubmission?.referrer ?? null,
    },
  }).catch((err) =>
    logger.warn({ err, subscriberId: row.id }, "HubSpot enqueue failed (subscribe DOI confirm)"),
  );

  const unsubscribeToken = signSubscriberUnsubscribeToken(row.id);
  const unsubscribeUrl = `${siteOrigin()}/api/forms/subscribe/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  res.type("html").send(
    renderConfirmPage({
      ok: true,
      title: "Subscription confirmed",
      body: `Thanks — <strong>${row.email}</strong> is now subscribed to Synozur Alliance insights. We'll only send occasional research and announcements, never spam.`,
      unsubscribeUrl,
    }),
  );
});

// One-click unsubscribe for confirmed subscribers. The link must be a
// signed token (not a raw email) — otherwise anyone who knows or guesses an
// address could unsubscribe that person from marketing. Token signs the
// stable `subscribers.id` so an outstanding link cannot be repurposed if the
// row is recreated.
router.get("/forms/subscribe/unsubscribe", async (req, res): Promise<void> => {
  const token = typeof req.query["token"] === "string" ? req.query["token"] : null;
  const payload = verifySubscriberUnsubscribeToken(token);
  if (!payload) {
    res.status(400).type("html").send(
      renderConfirmPage({
        ok: false,
        title: "Unsubscribe link invalid",
        body:
          "This unsubscribe link is invalid. Please use the unsubscribe link from a recent email, or contact us directly.",
      }),
    );
    return;
  }
  const row = await db.query.subscribersTable.findFirst({
    where: eq(subscribersTable.id, payload.subscriberId),
  });
  if (!row) {
    res.type("html").send(
      renderConfirmPage({
        ok: true,
        title: "You're not on our list",
        body: "We don't have a matching subscription on file. No further action needed.",
      }),
    );
    return;
  }
  await db
    .update(subscribersTable)
    .set({
      status: "unsubscribed",
      unsubscribedAt: new Date(),
      confirmationTokenHash: null,
    })
    .where(eq(subscribersTable.id, row.id));
  res.type("html").send(
    renderConfirmPage({
      ok: true,
      title: "You've been unsubscribed",
      body: `<strong>${row.email}</strong> has been removed from Synozur Alliance marketing. We won't send you marketing email anymore.`,
    }),
  );
});

// ---------------------------------------------------------------------------
// #259 — Admin endpoints for /admin/marketing/subscribers
// ---------------------------------------------------------------------------

router.get("/admin/marketing/subscribers", requireAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query["status"] === "string" ? req.query["status"] : "";
  const search = typeof req.query["search"] === "string" ? req.query["search"] : "";
  const conditions: SQL[] = [];
  if (status === "pending" || status === "confirmed" || status === "unsubscribed") {
    conditions.push(eq(subscribersTable.status, status));
  }
  if (search.trim().length > 0) {
    conditions.push(ilike(subscribersTable.email, `%${search.trim()}%`));
  }
  const where =
    conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
  const baseQuery = db.select().from(subscribersTable);
  const filtered = where ? baseQuery.where(where) : baseQuery;
  const rows = await filtered.orderBy(desc(subscribersTable.createdAt)).limit(500);

  const counts = await db
    .select({ status: subscribersTable.status, count: sql<number>`count(*)::int` })
    .from(subscribersTable)
    .groupBy(subscribersTable.status);
  const funnel = { pending: 0, confirmed: 0, unsubscribed: 0 } as Record<string, number>;
  for (const c of counts) funnel[c.status] = c.count;

  res.json({
    funnel,
    items: rows.map((r) => ({
      id: r.id,
      email: r.email,
      status: r.status,
      source: r.source,
      confirmationSentAt: r.confirmationSentAt,
      confirmedAt: r.confirmedAt,
      confirmedIp: r.confirmedIp,
      unsubscribedAt: r.unsubscribedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});

router.post(
  "/admin/marketing/subscribers/:id/resend",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid subscriber id" });
      return;
    }
    const row = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.id, id),
    });
    if (!row) {
      res.status(404).json({ error: "Subscriber not found" });
      return;
    }
    // Restrict resend to pending rows only. We deliberately do NOT revive
    // unsubscribed rows through this admin path — bringing someone back from
    // 'unsubscribed' to 'pending' without a fresh user-initiated subscribe
    // is a compliance hazard. They must hit /forms/subscribe themselves.
    if (row.status !== "pending") {
      res.status(400).json({
        error:
          row.status === "confirmed"
            ? "Subscriber is already confirmed"
            : "Subscriber is unsubscribed; they must resubscribe themselves",
      });
      return;
    }
    const { token, hash } = signSubscriberConfirmToken(row.id);
    await db
      .update(subscribersTable)
      .set({
        status: "pending",
        confirmationTokenHash: hash,
        confirmationSentAt: new Date(),
      })
      .where(eq(subscribersTable.id, row.id));
    const confirmUrl = await buildConfirmUrl(token);
    const result = await sendSubscriptionConfirmation({ to: row.email, confirmUrl });
    res.json({ ok: result.status !== "error", emailStatus: result.status, error: result.error });
  },
);



router.post("/forms/start", async (req, res): Promise<void> => {
  const parsed = StartBodyExt.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.website && data.website.trim() !== "") {
    res.json(SubmitContactResponse.parse({ ok: true, id: 0 }));
    return;
  }
  const ip = clientIp(req);
  if (!(await verifyTurnstile(data.turnstileToken, ip))) {
    res.status(400).json({ error: "Bot check failed. Please reload and try again.", code: "bot_check_failed" });
    return;
  }
  const {
    turnstileToken: _t,
    website: _w,
    marketingOptIn: _m,
    utmSource: _us,
    utmMedium: _um,
    utmCampaign: _uc,
    utmTerm: _ut,
    utmContent: _uct,
    landingPage: _lp,
    referrer: _ref,
    ...payload
  } = data;
  const attribution = await resolveAttribution("start", data);
  const webhook = await forwardToWebhook({ formType: "start", ...payload });
  const id = await persist({
    formType: "start",
    email: payload.email,
    name: payload.name,
    company: payload.company,
    payload,
    req,
    webhook,
    attribution,
  });
  void sendEmails({
    formType: "start",
    submissionId: id,
    email: payload.email,
    name: payload.name,
    payload,
  });
  void enqueueContactSubmission({
    formType: "start",
    submissionId: id,
    email: payload.email,
    name: payload.name,
    company: payload.company,
    marketingOptIn: attribution.marketingOptIn,
    payload,
    utm: attribution.utm,
  }).catch((err) => logger.warn({ err, id }, "HubSpot enqueue failed (start)"));
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

export default router;
