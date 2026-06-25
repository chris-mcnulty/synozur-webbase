import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, bookingsTable, siteSettingsTable, type Booking } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  isGraphBookingsConfigured,
  listBusinesses,
  getBusiness,
  listServices,
  getStaffAvailability,
  createAppointment,
  getBookingsGraphStatus,
  storeBookingsRefreshToken,
  clearBookingsRefreshToken,
} from "../lib/graphBookings";
import {
  buildAuthorizeUrl,
  fetchDiscovery,
  generatePkcePair,
  generateRandomToken,
  isEntraConfigured,
} from "../lib/entraOidc";
import {
  persistAuthPendingState,
  consumeAuthPendingState,
} from "../lib/authStateStore";
import { verifyTurnstile } from "../lib/turnstile";

const router: IRouter = Router();

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function ipKey(req: { headers: Record<string, unknown>; ip?: string }): string {
  const xff = Array.isArray(req.headers["x-forwarded-for"])
    ? (req.headers["x-forwarded-for"] as string[])[0]
    : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const ip = xff || req.ip || "0.0.0.0";
  return ipKeyGenerator(ip);
}

const SCOPES = ["general", "offer", "conference"] as const;

// Allow-list of Microsoft Bookings hostnames. The embedUrl is rendered into a
// public <iframe src> and <a href>, so the validator below (a) rejects any
// scheme other than http(s) — z.string().url() accepts javascript: and data:,
// which would let an admin store an XSS payload — and (b) restricts the host
// to the Microsoft surfaces that actually serve Bookings. Extend the list if
// MS introduces a new host (e.g. a regional cloud).
const ALLOWED_BOOKING_HOSTS = new Set<string>([
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.live.com",
  "book.ms",
]);

const embedUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      return ALLOWED_BOOKING_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, "embedUrl must be an https URL on a Microsoft Bookings host (outlook.office.com, outlook.office365.com, outlook.live.com, or book.ms)");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function ensureUniqueSlug(base: string, ignoreId?: string): Promise<string> {
  const seed = base || `booking-${Date.now()}`;
  let candidate = seed;
  let i = 2;
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(eq(bookingsTable.slug, candidate));
    const conflict = existing.find((row) => row.id !== ignoreId);
    if (!conflict) return candidate;
    candidate = `${seed}-${i++}`;
  }
  return `${seed}-${Date.now()}`;
}

function serialize(b: Booking) {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    teaser: b.teaser,
    descriptionHtml: b.descriptionHtml,
    embedUrl: b.embedUrl,
    scope: b.scope,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    displayOrder: b.displayOrder,
    active: b.active,
    seoTitle: b.seoTitle,
    seoDescription: b.seoDescription,
    msBusinessId: b.msBusinessId,
    msDefaultServiceId: b.msDefaultServiceId,
    msTimezone: b.msTimezone,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

const Body = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  teaser: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  embedUrl: embedUrlSchema,
  scope: z.enum(SCOPES).default("general"),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  displayOrder: z.number().int().optional(),
  active: z.boolean().optional(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  // Native (Graph) integration. msBusinessId is the identifier from the
  // Microsoft Graph /solutions/bookingBusinesses/{id} resource. This may be
  // a non-GUID string (for example, the business email address / UPN). When
  // the site-level mode is "native" and this is set, the public /start/{slug}
  // page renders an on-brand React flow against Graph instead of the iframe.
  msBusinessId: z.string().trim().min(1).max(200).nullish(),
  msDefaultServiceId: z.string().trim().min(1).max(200).nullish(),
  // Fallback IANA or Windows timezone when Graph returns null timezones.
  msTimezone: z.string().trim().min(1).max(100).nullish(),
});

// ---------------------------------------------------------------------------
// Public — list active bookings within their time window, plus per-slug fetch.
// ---------------------------------------------------------------------------

router.get("/bookings", async (_req, res): Promise<void> => {
  const now = new Date();
  const rows = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.active, true),
        or(sql`${bookingsTable.startsAt} is null`, sql`${bookingsTable.startsAt} <= ${now}`),
        or(sql`${bookingsTable.endsAt} is null`, sql`${bookingsTable.endsAt} > ${now}`),
      ),
    )
    .orderBy(asc(bookingsTable.displayOrder), asc(bookingsTable.title));
  res.json({ items: rows.map(serialize) });
});

router.get("/bookings/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  const [row] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.slug, slug));
  if (!row || !row.active) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const now = new Date();
  if (row.startsAt && row.startsAt > now) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (row.endsAt && row.endsAt <= now) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(serialize(row));
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

router.get("/admin/bookings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(bookingsTable)
    .orderBy(asc(bookingsTable.displayOrder), asc(bookingsTable.title));
  res.json({ items: rows.map(serialize) });
});

// ---------------------------------------------------------------------------
// Admin — Microsoft Graph OAuth consent flow.
//
// IMPORTANT: these named routes MUST be registered before /admin/bookings/:id
// so Express doesn't treat "graph-authorize" etc. as an ID param.
//
// The Bookings API requires delegated (user-based) authentication — confirmed
// by Microsoft support. This flow lets an admin connect a service account once;
// the resulting refresh token lives in `service_tokens` and is reused/rotated
// automatically by graphBookings.ts.
//
// Pre-requisite: add /api/admin/bookings/graph-callback to the Entra app
// registration's Redirect URIs (Web platform) before starting the flow.
// ---------------------------------------------------------------------------

const BOOKINGS_OAUTH_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Bookings.ReadWrite.All",
  // Calendars.Read is required for POST /me/calendar/getSchedule, which returns
  // true free/busy from Outlook (including personal calendar blocks, OOO, etc.)
  // and is more accurate than the Bookings calendarView endpoint (which only
  // shows Bookings appointments). This scope is safe — it requests read-only
  // access to calendar data; no write permission is added.
  "https://graph.microsoft.com/Calendars.Read",
];

function deriveBookingsCallbackUri(req: Request): string {
  const proto = req.get("x-forwarded-proto") ?? (req.secure ? "https" : "http");
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? req.hostname;
  return `${proto}://${host}/api/admin/bookings/graph-callback`;
}

router.get("/admin/bookings/graph-status", requireAdmin, async (_req, res): Promise<void> => {
  if (!isGraphBookingsConfigured()) {
    res.json({ connected: false, account: null, entraConfigured: false });
    return;
  }
  const status = await getBookingsGraphStatus();
  res.json({ ...status, entraConfigured: true });
});

router.get("/admin/bookings/graph-authorize", requireAdmin, async (req, res): Promise<void> => {
  if (!isEntraConfigured()) {
    res.status(503).json({ error: "Entra OIDC is not configured on this server." });
    return;
  }
  const pkce = generatePkcePair();
  const state = generateRandomToken(24);
  const nonce = generateRandomToken(16);
  const redirectUri = deriveBookingsCallbackUri(req);
  await persistAuthPendingState({
    state,
    codeVerifier: pkce.verifier,
    nonce,
    returnTo: "/admin/people/bookings",
    redirectUri,
  });
  const authorizeUrl = await buildAuthorizeUrl({
    state,
    nonce,
    pkceChallenge: pkce.challenge,
    redirectUri,
    scope: BOOKINGS_OAUTH_SCOPES,
    prompt: "select_account",
  });
  res.redirect(authorizeUrl);
});

// No requireAdmin — this endpoint receives the browser redirect from Microsoft.
// CSRF protection is via the `state` PKCE parameter.
router.get("/admin/bookings/graph-callback", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const { code, state, error: oauthError } = q;

  if (oauthError) {
    const msg = encodeURIComponent(`Microsoft sign-in failed: ${oauthError}`);
    res.redirect(`/admin/people/bookings?graphError=${msg}`);
    return;
  }
  if (!code || !state) {
    res.redirect("/admin/people/bookings?graphError=missing_params");
    return;
  }

  const pending = await consumeAuthPendingState(state);
  if (!pending) {
    res.redirect("/admin/people/bookings?graphError=invalid_or_expired_state");
    return;
  }

  let refreshToken: string | null = null;
  let accountHint: string | null = null;
  try {
    const disco = await fetchDiscovery();
    const body = new URLSearchParams({
      client_id: process.env["ENTRA_APP_CLIENT_ID"] ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri ?? deriveBookingsCallbackUri(req),
      code_verifier: pending.codeVerifier,
      scope: BOOKINGS_OAUTH_SCOPES.join(" "),
    });
    const secret = process.env["ENTRA_CLIENT_SECRET"] ?? process.env["ENTRA_APP_CLIENT_SECRET"];
    if (secret) body.set("client_secret", secret);

    const tokenRes = await fetch(disco.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const text = (await tokenRes.text()).slice(0, 300);
      req.log.warn({ status: tokenRes.status, body: text }, "Bookings Graph code exchange failed");
      const msg = encodeURIComponent("Token exchange with Microsoft failed — check server logs.");
      res.redirect(`/admin/people/bookings?graphError=${msg}`);
      return;
    }

    const json = (await tokenRes.json()) as Record<string, unknown>;
    refreshToken = typeof json["refresh_token"] === "string" ? (json["refresh_token"] as string) : null;

    // Decode id_token (if present) to extract the account UPN for display.
    const idToken = typeof json["id_token"] === "string" ? (json["id_token"] as string) : null;
    if (idToken) {
      try {
        const parts = idToken.split(".");
        if (parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
          accountHint =
            (payload["preferred_username"] as string | undefined) ??
            (payload["email"] as string | undefined) ??
            (payload["upn"] as string | undefined) ??
            null;
        }
      } catch {
        // Account hint is display-only; failure is non-fatal.
      }
    }
  } catch (err) {
    req.log.warn({ err }, "Bookings Graph callback threw");
    const msg = encodeURIComponent("Unexpected error during Microsoft sign-in — check server logs.");
    res.redirect(`/admin/people/bookings?graphError=${msg}`);
    return;
  }

  if (!refreshToken) {
    const msg = encodeURIComponent(
      "Microsoft did not return a refresh token. Ensure offline_access scope is included and the app supports it.",
    );
    res.redirect(`/admin/people/bookings?graphError=${msg}`);
    return;
  }

  await storeBookingsRefreshToken(refreshToken, accountHint);
  req.log.info({ accountHint }, "Bookings Graph service account connected");
  res.redirect("/admin/people/bookings?graphConnected=1");
});

router.delete("/admin/bookings/graph-token", requireAdmin, async (req, res): Promise<void> => {
  await clearBookingsRefreshToken();
  req.log.info("Bookings Graph service account disconnected by admin");
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Admin — create a new booking.
// ---------------------------------------------------------------------------

router.post("/admin/bookings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase);
  const [row] = await db
    .insert(bookingsTable)
    .values({
      slug,
      title: parsed.data.title,
      teaser: parsed.data.teaser ?? null,
      descriptionHtml: parsed.data.descriptionHtml ?? null,
      embedUrl: parsed.data.embedUrl,
      scope: parsed.data.scope,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      displayOrder: parsed.data.displayOrder ?? 0,
      active: parsed.data.active ?? true,
      seoTitle: parsed.data.seoTitle ?? null,
      seoDescription: parsed.data.seoDescription ?? null,
      msBusinessId: parsed.data.msBusinessId ?? null,
      msDefaultServiceId: parsed.data.msDefaultServiceId ?? null,
      msTimezone: parsed.data.msTimezone ?? null,
    })
    .returning();
  res.status(201).json(serialize(row!));
});

// ---------------------------------------------------------------------------
// Admin — Graph diagnostic: list all Bookings businesses visible to the app.
// Useful for verifying that the correct msBusinessId values are stored.
// IMPORTANT: must be registered before /admin/bookings/:id so Express does
// not treat "graph-diagnose" as an id param.
// ---------------------------------------------------------------------------

router.get("/admin/bookings/graph-diagnose", requireAdmin, async (_req, res): Promise<void> => {
  if (!isGraphBookingsConfigured()) {
    res.status(503).json({ error: "Graph credentials not configured (ENTRA_* env vars missing)." });
    return;
  }
  const result = await listBusinesses();
  if (!result.ok) {
    res.status(result.status).json({ error: result.message });
    return;
  }
  res.json({
    businesses: result.businesses.map((b) => ({
      id: b.id,
      displayName: b.displayName,
    })),
  });
});

// ---------------------------------------------------------------------------
// Admin — fetch a single booking by id.
// ---------------------------------------------------------------------------

router.get("/admin/bookings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(serialize(row));
});

router.patch("/admin/bookings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = Body.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.title !== undefined) updates.title = d.title;
  if (d.teaser !== undefined) updates.teaser = d.teaser ?? null;
  if (d.descriptionHtml !== undefined) updates.descriptionHtml = d.descriptionHtml ?? null;
  if (d.embedUrl !== undefined) updates.embedUrl = d.embedUrl;
  if (d.scope !== undefined) updates.scope = d.scope;
  if (d.startsAt !== undefined) updates.startsAt = d.startsAt ?? null;
  if (d.endsAt !== undefined) updates.endsAt = d.endsAt ?? null;
  if (d.displayOrder !== undefined) updates.displayOrder = d.displayOrder;
  if (d.active !== undefined) updates.active = d.active;
  if (d.seoTitle !== undefined) updates.seoTitle = d.seoTitle ?? null;
  if (d.seoDescription !== undefined) updates.seoDescription = d.seoDescription ?? null;
  if (d.msBusinessId !== undefined) updates.msBusinessId = d.msBusinessId ?? null;
  if (d.msDefaultServiceId !== undefined) updates.msDefaultServiceId = d.msDefaultServiceId ?? null;
  if (d.msTimezone !== undefined) updates.msTimezone = d.msTimezone ?? null;

  if (d.slug !== undefined && d.slug !== null) {
    const slugBase = d.slug.trim() || slugify(d.title ?? existing.title);
    updates.slug = await ensureUniqueSlug(slugBase, id);
  } else if (d.title !== undefined && !existing.slug) {
    updates.slug = await ensureUniqueSlug(slugify(d.title), id);
  }

  const [row] = await db
    .update(bookingsTable)
    .set(updates)
    .where(eq(bookingsTable.id, id))
    .returning();
  res.json(serialize(row));
});

router.delete("/admin/bookings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db
    .delete(bookingsTable)
    .where(eq(bookingsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Public — Microsoft Graph "native" mode.
//
// These endpoints are gated on three things:
//   1. The site-level `bookingsRenderMode` is "native".
//   2. The booking row has `msBusinessId` populated.
//   3. The Graph credentials env vars are present (otherwise we 503 with a
//      message the visitor can act on by reloading after ops fix it).
//
// We resolve the booking row by slug for every request (rather than trusting
// a businessId from the client) so the surface area for a misconfigured row
// to leak information about other Bookings calendars is zero.
// ---------------------------------------------------------------------------

const SETTINGS_ID = 1;

async function loadBookingForNative(
  slug: string,
): Promise<
  | { ok: true; businessId: string; defaultServiceId: string | null; msTimezone: string | null }
  | { ok: false; status: number; message: string }
> {
  const [settings] = await db
    .select({ mode: siteSettingsTable.bookingsRenderMode })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ID));
  if ((settings?.mode ?? "iframe") !== "native") {
    return { ok: false, status: 404, message: "Native bookings are not enabled." };
  }
  const [row] = await db
    .select({
      active: bookingsTable.active,
      startsAt: bookingsTable.startsAt,
      endsAt: bookingsTable.endsAt,
      msBusinessId: bookingsTable.msBusinessId,
      msDefaultServiceId: bookingsTable.msDefaultServiceId,
      msTimezone: bookingsTable.msTimezone,
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.slug, slug));
  if (!row || !row.active) return { ok: false, status: 404, message: "Booking not found." };
  const now = new Date();
  if (row.startsAt && row.startsAt > now) return { ok: false, status: 404, message: "Booking not found." };
  if (row.endsAt && row.endsAt <= now) return { ok: false, status: 404, message: "Booking not found." };
  if (!row.msBusinessId) {
    return { ok: false, status: 409, message: "This booking is not configured for native rendering." };
  }
  // Strip trailing slashes/spaces so a value copy-pasted from a Bookings URL
  // (which often ends with a trailing slash) doesn't produce a malformed
  // Graph path after encodeURIComponent encodes the slash as %2F.
  const businessId = row.msBusinessId.trim().replace(/\/+$/, "");
  if (!businessId) {
    return { ok: false, status: 409, message: "This booking is not configured for native rendering." };
  }
  if (!isGraphBookingsConfigured()) {
    return {
      ok: false,
      status: 503,
      message: "Bookings provider is not configured on the server.",
    };
  }
  return { ok: true, businessId, defaultServiceId: row.msDefaultServiceId, msTimezone: row.msTimezone ?? null };
}

router.get("/bookings/:slug/services", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  const ctx = await loadBookingForNative(slug);
  if (!ctx.ok) {
    res.status(ctx.status).json({ error: ctx.message });
    return;
  }
  const [businessResult, servicesResult] = await Promise.all([
    getBusiness(ctx.businessId),
    listServices(ctx.businessId),
  ]);
  if (!businessResult.ok) {
    res.status(businessResult.status).json({ error: businessResult.message });
    return;
  }
  if (!servicesResult.ok) {
    res.status(servicesResult.status).json({ error: servicesResult.message });
    return;
  }
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    business: {
      displayName: businessResult.business.displayName,
      defaultTimeZone: businessResult.business.defaultTimeZone,
    },
    defaultServiceId: ctx.defaultServiceId,
    services: servicesResult.services.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      description: s.description,
      defaultDurationMinutes: s.defaultDurationMinutes,
      defaultPriceType: s.defaultPriceType,
      defaultPrice: s.defaultPrice,
    })),
  });
});

const AvailabilityQuery = z.object({
  serviceId: z.string().min(1),
  // ISO-8601 instants. Must be ≤ 62 days apart (Graph getSchedule limit).
  start: z.string().datetime(),
  end: z.string().datetime(),
});

const availabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `bk:av:${ipKey(req)}`,
});

router.get(
  "/bookings/:slug/availability",
  availabilityLimiter,
  async (req, res): Promise<void> => {
    const slug = String(req.params.slug);
    const parsed = AvailabilityQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const startMs = Date.parse(parsed.data.start);
    const endMs = Date.parse(parsed.data.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      res.status(400).json({ error: "Invalid date range." });
      return;
    }
    if (endMs - startMs > 62 * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: "Range too wide (max 62 days)." });
      return;
    }
    const ctx = await loadBookingForNative(slug);
    if (!ctx.ok) {
      res.status(ctx.status).json({ error: ctx.message });
      return;
    }
    const result = await getStaffAvailability({
      businessId: ctx.businessId,
      serviceId: parsed.data.serviceId,
      startUtc: parsed.data.start,
      endUtc: parsed.data.end,
      fallbackTimezone: ctx.msTimezone,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.json({
      slots: result.slots.map((s) => ({ startUtc: s.startUtc, endUtc: s.endUtc })),
    });
  },
);

const AppointmentBody = z.object({
  serviceId: z.string().min(1),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  customer: z.object({
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().max(50).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  }),
  customerTimeZone: z.string().trim().min(1).max(80),
  turnstileToken: z.string().nullish(),
  // Honeypot — clients leave this empty; bots fill it. Validated as a
  // plain optional string and checked at runtime so a non-empty value
  // short-circuits to the same success shape a real submit would produce
  // (matching the silent-accept pattern in routes/forms.ts).
  website: z.string().trim().optional(),
});

const appointmentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `bk:ap:${ipKey(req)}`,
});

router.post(
  "/bookings/:slug/appointments",
  appointmentLimiter,
  async (req, res): Promise<void> => {
    const slug = String(req.params.slug);
    const parsed = AppointmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Honeypot: if the hidden `website` field arrived populated, return the
    // same shape a real success would so a bot can't tell it was filtered.
    if (parsed.data.website && parsed.data.website.length > 0) {
      res.status(201).json({ ok: true });
      return;
    }
    const ip = clientIp(req);
    if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
      res.status(400).json({
        error: "Bot check failed. Please reload and try again.",
        code: "bot_check_failed",
      });
      return;
    }
    const ctx = await loadBookingForNative(slug);
    if (!ctx.ok) {
      res.status(ctx.status).json({ error: ctx.message });
      return;
    }
    const result = await createAppointment(ctx.businessId, {
      serviceId: parsed.data.serviceId,
      startUtc: parsed.data.startUtc,
      endUtc: parsed.data.endUtc,
      customer: {
        name: parsed.data.customer.name,
        email: parsed.data.customer.email,
        phone: parsed.data.customer.phone ?? null,
        notes: parsed.data.customer.notes ?? null,
      },
      customerTimeZone: parsed.data.customerTimeZone,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.status(201).json({ ok: true });
  },
);

export default router;
