import { eq } from "drizzle-orm";
import { db, serviceTokensTable } from "@workspace/db";
import { logger } from "./logger";

// Microsoft Graph Bookings client — delegated (service-account) authentication.
//
// Microsoft confirmed via support ticket that the Bookings API surface
// (/solutions/bookingBusinesses and all sub-resources) does NOT support
// app-only (client_credentials) tokens, even with Bookings.ReadWrite.All
// application permission and admin consent. Every call requires a delegated
// token from a signed-in user who has access to the Bookings calendars.
//
// The solution: a one-time "Connect service account" OAuth consent flow in the
// admin UI (/api/admin/bookings/graph-authorize → Microsoft → graph-callback).
// The resulting refresh token is stored in the `service_tokens` table under
// key "bookings_graph". Each request here:
//   1. Reads the refresh token from DB (cached in-process for 30 s).
//   2. Exchanges it for a short-lived access token (cached until near-expiry).
//   3. If MS returns a new refresh token (rotation), persists it.
//
// Credentials reuse the existing ENTRA_* env vars — the same app registration
// drives both user SSO and this service-account flow. The only additional step
// is adding /api/admin/bookings/graph-callback to the app reg's Redirect URIs.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SERVICE_TOKEN_KEY = "bookings_graph";

// Env helpers — reuse ENTRA_* vars from the user SSO app registration.
function bookingsTenantId(): string | null {
  return process.env["ENTRA_TENANT_ID"] ?? null;
}
function bookingsClientId(): string | null {
  return process.env["ENTRA_APP_CLIENT_ID"] ?? null;
}
function bookingsClientSecret(): string | null {
  const v = process.env["ENTRA_CLIENT_SECRET"] ?? process.env["ENTRA_APP_CLIENT_SECRET"];
  return v && v.length > 0 ? v : null;
}

export function isGraphBookingsConfigured(): boolean {
  return Boolean(bookingsTenantId() && bookingsClientId() && bookingsClientSecret());
}

// ---------------------------------------------------------------------------
// In-process caches
// ---------------------------------------------------------------------------

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

// Delegated access token cache (single service account).
let delegatedTokenCache: AccessTokenCache | null = null;

// Row cache to avoid a DB round-trip on every request (30 s TTL).
interface RowCache {
  row: { refreshToken: string; accountHint: string | null } | null;
  fetchedAt: number;
}
let rowCache: RowCache | null = null;
const ROW_CACHE_TTL = 30_000;

function invalidateRowCache(): void {
  rowCache = null;
  delegatedTokenCache = null;
}

// ---------------------------------------------------------------------------
// Public token-store management (called by the admin OAuth routes)
// ---------------------------------------------------------------------------

export async function storeBookingsRefreshToken(
  refreshToken: string,
  accountHint: string | null,
): Promise<void> {
  await db
    .insert(serviceTokensTable)
    .values({ key: SERVICE_TOKEN_KEY, refreshToken, accountHint, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: serviceTokensTable.key,
      set: { refreshToken, accountHint, updatedAt: new Date() },
    });
  invalidateRowCache();
}

export async function clearBookingsRefreshToken(): Promise<void> {
  await db.delete(serviceTokensTable).where(eq(serviceTokensTable.key, SERVICE_TOKEN_KEY));
  invalidateRowCache();
}

export async function getBookingsGraphStatus(): Promise<{
  connected: boolean;
  account: string | null;
}> {
  const row = await loadRow();
  return { connected: Boolean(row), account: row?.accountHint ?? null };
}

// ---------------------------------------------------------------------------
// Internal: load refresh token row (with cache)
// ---------------------------------------------------------------------------

async function loadRow(): Promise<{ refreshToken: string; accountHint: string | null } | null> {
  const now = Date.now();
  if (rowCache && now - rowCache.fetchedAt < ROW_CACHE_TTL) {
    return rowCache.row;
  }
  const [row] = await db
    .select({ refreshToken: serviceTokensTable.refreshToken, accountHint: serviceTokensTable.accountHint })
    .from(serviceTokensTable)
    .where(eq(serviceTokensTable.key, SERVICE_TOKEN_KEY));
  const value = row ?? null;
  rowCache = { row: value, fetchedAt: now };
  return value;
}

// ---------------------------------------------------------------------------
// Internal: get (or refresh) the delegated access token
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const now = Date.now();

  // Return cached access token if still valid (with 90-second buffer).
  if (delegatedTokenCache && delegatedTokenCache.expiresAt - 90_000 > now) {
    return delegatedTokenCache.token;
  }

  if (!isGraphBookingsConfigured()) return null;

  const row = await loadRow();
  if (!row) return null;

  const tenantId = bookingsTenantId()!;
  const clientId = bookingsClientId()!;
  const clientSecret = bookingsClientSecret()!;

  try {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
      scope: "offline_access https://graph.microsoft.com/Bookings.ReadWrite.All",
    });
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      logger.warn({ status: res.status, body: text, tenantId }, "Bookings Graph refresh token exchange failed");
      // Invalidate cache so next call retries immediately.
      rowCache = null;
      delegatedTokenCache = null;
      return null;
    }

    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!json.access_token) return null;

    // Persist rotated refresh token if MS returned a new one.
    if (json.refresh_token && json.refresh_token !== row.refreshToken) {
      logger.info({ tenantId }, "Bookings Graph: persisting rotated refresh token");
      await storeBookingsRefreshToken(json.refresh_token, row.accountHint);
    }

    delegatedTokenCache = {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  } catch (err) {
    logger.warn({ err, tenantId }, "Bookings Graph token refresh threw");
    delegatedTokenCache = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: authenticated Graph fetch
// ---------------------------------------------------------------------------

/** Thin wrapper around fetch that injects the bearer token and parses JSON. */
async function graphFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const token = await getToken();
  if (!token) {
    const row = await loadRow();
    if (!row) {
      return {
        ok: false,
        status: 503,
        message:
          "Bookings provider is not connected. An admin must authorise the service account in Admin → Bookings.",
      };
    }
    return {
      ok: false,
      status: 503,
      message: "Bookings provider credentials could not be refreshed. Please re-connect the service account.",
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const fetchInit: RequestInit = { method: init.method ?? "GET", headers };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchInit.body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}${path}`, fetchInit);
  } catch (err) {
    logger.warn({ err, path }, "Bookings Graph network error");
    return { ok: false, status: 502, message: "Bookings provider is unreachable." };
  }

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    logger.warn({ status: res.status, body: text, path }, "Bookings Graph call failed");
    if (res.status === 404) return { ok: false, status: 404, message: "Booking calendar not found." };
    if (res.status === 401 || res.status === 403) {
      // Might be a stale access token — evict so next call re-fetches.
      delegatedTokenCache = null;
      return {
        ok: false,
        status: 502,
        message: "Bookings provider rejected our credentials. The service account may need re-authorisation.",
      };
    }
    return { ok: false, status: 502, message: "Bookings provider returned an error." };
  }

  const json = (await res.json()) as unknown;
  return { ok: true, json };
}

// ---------------------------------------------------------------------------
// Public API — unchanged signatures, just the token source is different
// ---------------------------------------------------------------------------

export interface GraphBookingService {
  id: string;
  displayName: string;
  description: string | null;
  defaultDurationMinutes: number | null;
  defaultPriceType: string | null;
  defaultPrice: number | null;
  isHiddenFromCustomers: boolean;
}

export interface GraphBookingBusinessSummary {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  webSiteUrl: string | null;
  defaultTimeZone: string | null;
}

export interface GraphTimeSlot {
  /** ISO-8601 instant. Microsoft returns a wall-clock + tz; we normalize to UTC. */
  startUtc: string;
  /** ISO-8601 instant. */
  endUtc: string;
  staffIds: string[];
}

export interface CreateAppointmentArgs {
  serviceId: string;
  /** ISO-8601 instant (UTC). */
  startUtc: string;
  /** ISO-8601 instant (UTC). */
  endUtc: string;
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    notes?: string | null;
  };
  /** IANA timezone for the customer (used in the appointment record). */
  customerTimeZone: string;
}

function isoToGraphDateTime(iso: string): { dateTime: string; timeZone: string } {
  const stripped = iso.endsWith("Z") ? iso.slice(0, -1) : iso;
  return { dateTime: stripped, timeZone: "UTC" };
}

function dateTimeToUtcIso(dt: { dateTime?: string; timeZone?: string } | undefined): string | null {
  if (!dt?.dateTime) return null;
  const hasZ = dt.dateTime.endsWith("Z");
  return hasZ ? dt.dateTime : `${dt.dateTime}Z`;
}

export async function listBusinesses(): Promise<
  | { ok: true; businesses: { id: string; displayName: string; email: string | null }[] }
  | { ok: false; status: number; message: string }
> {
  const result = await graphFetch(`/solutions/bookingBusinesses`);
  if (!result.ok) return result;
  const j = result.json as {
    value?: { id?: string; displayName?: string; email?: string | null }[];
  };
  return {
    ok: true,
    businesses: (j.value ?? []).map((b) => ({
      id: b.id ?? "",
      displayName: b.displayName ?? "",
      email: b.email ?? null,
    })),
  };
}

export async function getBusiness(
  businessId: string,
): Promise<{ ok: true; business: GraphBookingBusinessSummary } | { ok: false; status: number; message: string }> {
  const result = await graphFetch(`/solutions/bookingBusinesses/${encodeURIComponent(businessId)}`);
  if (!result.ok) return result;
  const j = result.json as {
    id?: string;
    displayName?: string;
    email?: string | null;
    phone?: string | null;
    webSiteUrl?: string | null;
    defaultTimeZone?: string | null;
  };
  return {
    ok: true,
    business: {
      id: j.id ?? businessId,
      displayName: j.displayName ?? "",
      email: j.email ?? null,
      phone: j.phone ?? null,
      webSiteUrl: j.webSiteUrl ?? null,
      defaultTimeZone: j.defaultTimeZone ?? null,
    },
  };
}

export async function listServices(
  businessId: string,
): Promise<{ ok: true; services: GraphBookingService[] } | { ok: false; status: number; message: string }> {
  const result = await graphFetch(
    `/solutions/bookingBusinesses/${encodeURIComponent(businessId)}/services`,
  );
  if (!result.ok) return result;
  const j = result.json as {
    value?: Array<{
      id?: string;
      displayName?: string;
      description?: string | null;
      defaultDuration?: string | null;
      defaultPriceType?: string | null;
      defaultPrice?: number | null;
      isHiddenFromCustomers?: boolean;
    }>;
  };
  const services: GraphBookingService[] = (j.value ?? [])
    .filter((s) => s.id && !s.isHiddenFromCustomers)
    .map((s) => ({
      id: s.id!,
      displayName: s.displayName ?? "",
      description: s.description ?? null,
      defaultDurationMinutes: parseIso8601DurationMinutes(s.defaultDuration ?? null),
      defaultPriceType: s.defaultPriceType ?? null,
      defaultPrice: typeof s.defaultPrice === "number" ? s.defaultPrice : null,
      isHiddenFromCustomers: Boolean(s.isHiddenFromCustomers),
    }));
  return { ok: true, services };
}

/**
 * Fetch open slots for a service in a UTC date range.
 * `startUtc` / `endUtc` are ISO-8601 instants. Microsoft requires the window
 * to be ≤ 30 days; the route layer enforces a tighter cap.
 */
export async function getStaffAvailability(args: {
  businessId: string;
  serviceId: string;
  startUtc: string;
  endUtc: string;
}): Promise<{ ok: true; slots: GraphTimeSlot[] } | { ok: false; status: number; message: string }> {
  const svc = await graphFetch(
    `/solutions/bookingBusinesses/${encodeURIComponent(args.businessId)}/services/${encodeURIComponent(args.serviceId)}`,
  );
  if (!svc.ok) return svc;
  const svcJson = svc.json as { staffMemberIds?: string[]; defaultDuration?: string | null };
  const staffIds = Array.isArray(svcJson.staffMemberIds) ? svcJson.staffMemberIds : [];
  const durationMinutes = parseIso8601DurationMinutes(svcJson.defaultDuration ?? null) ?? 30;

  if (staffIds.length === 0) {
    return { ok: true, slots: [] };
  }

  const result = await graphFetch(
    `/solutions/bookingBusinesses/${encodeURIComponent(args.businessId)}/getStaffAvailability`,
    {
      method: "POST",
      body: {
        staffIds,
        startDateTime: isoToGraphDateTime(args.startUtc),
        endDateTime: isoToGraphDateTime(args.endUtc),
      },
    },
  );
  if (!result.ok) return result;

  const j = result.json as {
    value?: Array<{
      staffId?: string;
      availabilityItems?: Array<{
        status?: string;
        startDateTime?: { dateTime?: string; timeZone?: string };
        endDateTime?: { dateTime?: string; timeZone?: string };
      }>;
    }>;
  };

  const byStart = new Map<string, GraphTimeSlot>();
  for (const staff of j.value ?? []) {
    const staffId = staff.staffId;
    if (!staffId) continue;
    for (const item of staff.availabilityItems ?? []) {
      if (item.status !== "available") continue;
      const startUtc = dateTimeToUtcIso(item.startDateTime);
      const endUtc = dateTimeToUtcIso(item.endDateTime);
      if (!startUtc || !endUtc) continue;
      const windowStart = new Date(startUtc).getTime();
      const windowEnd = new Date(endUtc).getTime();
      if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) continue;
      for (let t = windowStart; t + durationMinutes * 60_000 <= windowEnd; t += durationMinutes * 60_000) {
        const slotStart = new Date(t).toISOString();
        const slotEnd = new Date(t + durationMinutes * 60_000).toISOString();
        const existing = byStart.get(slotStart);
        if (existing) {
          if (!existing.staffIds.includes(staffId)) existing.staffIds.push(staffId);
        } else {
          byStart.set(slotStart, { startUtc: slotStart, endUtc: slotEnd, staffIds: [staffId] });
        }
      }
    }
  }

  const slots = [...byStart.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return { ok: true, slots };
}

export async function createAppointment(
  businessId: string,
  args: CreateAppointmentArgs,
): Promise<{ ok: true; appointmentId: string } | { ok: false; status: number; message: string }> {
  const body = {
    "@odata.type": "#microsoft.graph.bookingAppointment",
    serviceId: args.serviceId,
    startDateTime: isoToGraphDateTime(args.startUtc),
    endDateTime: isoToGraphDateTime(args.endUtc),
    customerTimeZone: args.customerTimeZone,
    customers: [
      {
        "@odata.type": "#microsoft.graph.bookingCustomerInformation",
        name: args.customer.name,
        emailAddress: args.customer.email,
        phone: args.customer.phone ?? "",
        notes: args.customer.notes ?? "",
        timeZone: args.customerTimeZone,
      },
    ],
  };
  const result = await graphFetch(
    `/solutions/bookingBusinesses/${encodeURIComponent(businessId)}/appointments`,
    { method: "POST", body },
  );
  if (!result.ok) return result;
  const j = result.json as { id?: string };
  if (!j.id) {
    return { ok: false, status: 502, message: "Bookings provider did not return an appointment id." };
  }
  return { ok: true, appointmentId: j.id };
}

// ISO-8601 duration like "PT30M", "PT1H", "PT1H30M" → minutes.
function parseIso8601DurationMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  const seconds = match[3] ? Number(match[3]) : 0;
  const total = hours * 60 + minutes + Math.round(seconds / 60);
  return total > 0 ? total : null;
}
