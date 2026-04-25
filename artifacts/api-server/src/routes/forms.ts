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
import { db, formSubmissionsTable, siteSettingsTable, type FormSubmission } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";
import { sendVisitorConfirmation, sendInternalNotification } from "../lib/email";
import { verifyTurnstile } from "../lib/turnstile";
import { enqueueContactSubmission, type FormType } from "../lib/hubspotSync";

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
  const attribution = await resolveAttribution("subscribe", data);
  const webhook = await forwardToWebhook({ formType: "subscribe", ...payload });
  const id = await persist({
    formType: "subscribe",
    email: payload.email,
    name: null,
    company: null,
    payload,
    req,
    webhook,
    attribution,
  });
  void sendEmails({
    formType: "subscribe",
    submissionId: id,
    email: payload.email,
    name: null,
    payload,
  });
  void enqueueContactSubmission({
    formType: "subscribe",
    submissionId: id,
    email: payload.email,
    name: null,
    company: null,
    marketingOptIn: attribution.marketingOptIn,
    payload,
    utm: attribution.utm,
  }).catch((err) => logger.warn({ err, id }, "HubSpot enqueue failed (subscribe)"));
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

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
