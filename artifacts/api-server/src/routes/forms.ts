import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  SubmitContactBody,
  SubmitSubscribeBody,
  SubmitStartBody,
  SubmitContactResponse,
  ListAdminFormSubmissionsQueryParams,
  ListAdminFormSubmissionsResponse,
  ExportAdminFormSubmissionsQueryParams,
} from "@workspace/api-zod";
import { db, formSubmissionsTable, type FormSubmission } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";
import { sendVisitorConfirmation, sendInternalNotification } from "../lib/email";

const router: IRouter = Router();

const WEBHOOK_URL = process.env["FORMS_WEBHOOK_URL"] ?? "";
const TURNSTILE_SECRET = process.env["TURNSTILE_SECRET_KEY"] ?? "";

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

async function verifyTurnstile(token: string | null | undefined, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams();
    body.set("secret", TURNSTILE_SECRET);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch (err) {
    logger.warn({ err }, "Turnstile verification failed");
    return false;
  }
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

router.post("/forms/contact", async (req, res): Promise<void> => {
  const parsed = SubmitContactBody.safeParse(req.body);
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
    res.status(400).json({ error: "Bot check failed. Please reload and try again." });
    return;
  }
  const { turnstileToken: _t, website: _w, ...payload } = data;
  const webhook = await forwardToWebhook({ formType: "contact", ...payload });
  const id = await persist({
    formType: "contact",
    email: payload.email,
    name: payload.name,
    company: payload.company,
    payload,
    req,
    webhook,
  });
  void sendEmails({
    formType: "contact",
    submissionId: id,
    email: payload.email,
    name: payload.name,
    payload,
  });
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

router.post("/forms/subscribe", async (req, res): Promise<void> => {
  const parsed = SubmitSubscribeBody.safeParse(req.body);
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
    res.status(400).json({ error: "Bot check failed. Please reload and try again." });
    return;
  }
  const { turnstileToken: _t, website: _w, ...payload } = data;
  const webhook = await forwardToWebhook({ formType: "subscribe", ...payload });
  const id = await persist({
    formType: "subscribe",
    email: payload.email,
    name: null,
    company: null,
    payload,
    req,
    webhook,
  });
  void sendEmails({
    formType: "subscribe",
    submissionId: id,
    email: payload.email,
    name: null,
    payload,
  });
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

router.post("/forms/start", async (req, res): Promise<void> => {
  const parsed = SubmitStartBody.safeParse(req.body);
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
    res.status(400).json({ error: "Bot check failed. Please reload and try again." });
    return;
  }
  const { turnstileToken: _t, website: _w, ...payload } = data;
  const webhook = await forwardToWebhook({ formType: "start", ...payload });
  const id = await persist({
    formType: "start",
    email: payload.email,
    name: payload.name,
    company: payload.company,
    payload,
    req,
    webhook,
  });
  void sendEmails({
    formType: "start",
    submissionId: id,
    email: payload.email,
    name: payload.name,
    payload,
  });
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

export default router;
