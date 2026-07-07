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

// App-only (client credentials) token cache.
// Used specifically for getStaffAvailability which Microsoft explicitly
// rejects with delegated (user) tokens:
//   "VASTT: Api Business.GetStaffAvailability does not support the token type: User"
// All other Bookings APIs continue to use the delegated path.
let appOnlyTokenCache: AccessTokenCache | null = null;

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
  appOnlyTokenCache = null;
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
// Internal: app-only (client credentials) token for APIs that reject user tokens
// ---------------------------------------------------------------------------

async function getAppOnlyToken(): Promise<string | null> {
  const now = Date.now();
  if (appOnlyTokenCache && appOnlyTokenCache.expiresAt - 90_000 > now) {
    return appOnlyTokenCache.token;
  }
  if (!isGraphBookingsConfigured()) return null;

  const tenantId = bookingsTenantId()!;
  const clientId = bookingsClientId()!;
  const clientSecret = bookingsClientSecret()!;

  try {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      logger.warn({ status: res.status, body: text, tenantId }, "Bookings Graph app-only token request failed");
      appOnlyTokenCache = null;
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    appOnlyTokenCache = {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  } catch (err) {
    logger.warn({ err, tenantId }, "Bookings Graph app-only token request threw");
    appOnlyTokenCache = null;
    return null;
  }
}

/** graphFetch variant that uses an app-only (client credentials) token.
 *  Required for Microsoft Graph APIs that reject delegated user tokens,
 *  specifically getStaffAvailability. */
async function graphFetchAppOnly(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const token = await getAppOnlyToken();
  if (!token) {
    return {
      ok: false,
      status: 503,
      message: "Bookings provider app credentials could not be obtained. Ensure ENTRA_* env vars are set and the app has Bookings.ReadWrite.All application permission with admin consent.",
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
    logger.warn({ err, path }, "Bookings Graph app-only network error");
    return { ok: false, status: 502, message: "Bookings provider is unreachable." };
  }

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    logger.warn({ status: res.status, body: text, path }, "Bookings Graph app-only call failed");
    if (res.status === 404) return { ok: false, status: 404, message: "Booking calendar not found." };
    if (res.status === 401 || res.status === 403) {
      appOnlyTokenCache = null;
      return {
        ok: false,
        status: 502,
        message: "Bookings provider rejected app credentials. Ensure the app registration has Bookings.ReadWrite.All application permission with admin consent.",
      };
    }
    return { ok: false, status: 502, message: "Bookings provider returned an error." };
  }

  const json = (await res.json()) as unknown;
  return { ok: true, json };
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
  /**
   * Staff member(s) to assign. Without this, Graph creates the appointment
   * UNASSIGNED — the customer gets a confirmation but no staff member is
   * booked or invited (unlike the hosted Bookings page, which always
   * assigns staff). Resolve this from the slot's free staff before creating.
   */
  staffMemberIds?: string[];
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

// ---------------------------------------------------------------------------
// Timezone helpers for slot computation
// ---------------------------------------------------------------------------

// Common Windows timezone name → IANA mapping (Microsoft Bookings staffMembers
// may return Windows timezone names rather than IANA names).
const WIN_TO_IANA: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Mountain Standard Time (Mexico)": "America/Chihuahua",
  "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time": "America/New_York",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Atlantic Standard Time": "America/Halifax",
  "Venezuela Standard Time": "America/Caracas",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Montevideo Standard Time": "America/Montevideo",
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "GTB Standard Time": "Europe/Bucharest",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "Arabic Standard Time": "Asia/Baghdad",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arab Standard Time": "Asia/Riyadh",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Calcutta",
  "Nepal Standard Time": "Asia/Katmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};

function resolveIana(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  if (WIN_TO_IANA[tz]) return WIN_TO_IANA[tz]!;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function parseHHMM(timeStr: string): { h: number; m: number } {
  // "08:00:00.0000000" → { h: 8, m: 0 }
  const [hStr, mStr] = timeStr.split(":");
  return { h: parseInt(hStr ?? "0", 10), m: parseInt(mStr ?? "0", 10) };
}

/** Return the day-of-week name ("monday" etc.) for a UTC ms value in a given timezone. */
function weekdayInTz(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" })
    .format(new Date(utcMs))
    .toLowerCase();
}

/** Return { year, month, day } (1-indexed) for a UTC ms value in a given timezone. */
function localDateInTz(utcMs: number, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Convert a wall-clock time (HH:MM) on a given local calendar date to UTC milliseconds.
 * Uses noon UTC of the same UTC calendar day to derive the UTC offset (avoids most
 * DST edge cases because noon is almost never in a DST transition gap).
 */
function wallClockToUtcMs(
  utcDayMs: number, // UTC midnight of the day being processed
  localDate: { year: number; month: number; day: number },
  h: number,
  m: number,
  tz: string,
): number {
  // Use noon UTC of this day to estimate the UTC offset.
  const noonUtc = utcDayMs + 12 * 3600_000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUtc));
  const localNoonH = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10);
  const localNoonM = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  // offsetMinutesEast = local - UTC (at noon UTC).
  // e.g. UTC-5: noon UTC → local 07:00 → offset = 7*60 - 12*60 = -300 (UTC is 5h ahead)
  const offsetMinutesEast = localNoonH * 60 + localNoonM - 720;
  // local time expressed as if it were UTC:
  const localAsUtcMs = Date.UTC(localDate.year, localDate.month - 1, localDate.day, h, m, 0);
  // UTC = localMs - offsetMinutesEast
  return localAsUtcMs - offsetMinutesEast * 60_000;
}

/** Normalise a Graph dateTime object (may or may not have a trailing Z) to UTC ISO string. */
function normaliseGraphDateTime(dt: { dateTime?: string; timeZone?: string } | undefined): string | null {
  if (!dt?.dateTime) return null;
  if (dt.timeZone && dt.timeZone.toUpperCase() !== "UTC") {
    // Non-UTC: just append Z as a best-effort (MS almost always returns UTC here).
    return dt.dateTime.endsWith("Z") ? dt.dateTime : `${dt.dateTime}Z`;
  }
  return dt.dateTime.endsWith("Z") ? dt.dateTime : `${dt.dateTime}Z`;
}

// ---------------------------------------------------------------------------
// Availability via staffMembers + calendarView (delegated token only)
// ---------------------------------------------------------------------------
//
// Microsoft's getStaffAvailability Graph action rejects delegated (user) tokens:
//   "VASTT: Api Business.GetStaffAvailability does not support the token type: User"
// And using an app-only token requires Bookings.ReadWrite.All as an *application*
// permission with admin consent in the app registration — a tenant-level change
// outside our deployment scope.
//
// This implementation derives the same information from two delegated-safe endpoints:
//   1. GET /staffMembers — provides working hours per staff member + timezone
//   2. GET /calendarView — provides existing (booked) appointments in the window
// We then compute free slots client-side (server-side here) using the same logic
// Microsoft would apply internally.

interface StaffMemberRaw {
  id?: string;
  displayName?: string;
  emailAddress?: string | null;
  timeZone?: string | null;
  workingHours?: Array<{
    day?: string;
    timeSlots?: Array<{ startTime?: string; endTime?: string }>;
  }>;
}

interface CalendarViewAppt {
  id?: string;
  startDateTime?: { dateTime?: string; timeZone?: string };
  endDateTime?: { dateTime?: string; timeZone?: string };
  staffMemberIds?: string[];
}

/**
 * Fetch open slots for a service in a UTC date range.
 * `startUtc` / `endUtc` are ISO-8601 instants. The route layer caps the window at 14 days.
 */
export async function getStaffAvailability(args: {
  businessId: string;
  serviceId: string;
  startUtc: string;
  endUtc: string;
  /** IANA or Windows timezone to use when Graph returns null for both the
   *  staff member and business defaultTimeZone fields. Set this to the
   *  admin-configured msTimezone on the booking row. */
  fallbackTimezone?: string | null;
}): Promise<{ ok: true; slots: GraphTimeSlot[] } | { ok: false; status: number; message: string }> {
  const bid = encodeURIComponent(args.businessId);

  // 1. Service details: staff IDs + appointment duration.
  const svcResult = await graphFetch(
    `/solutions/bookingBusinesses/${bid}/services/${encodeURIComponent(args.serviceId)}`,
  );
  if (!svcResult.ok) return svcResult;
  const svcJson = svcResult.json as {
    staffMemberIds?: string[];
    defaultDuration?: string | null;
    schedulingPolicy?: {
      timeSlotInterval?: string | null;
      minimumLeadTime?: string | null;
      generalAvailability?: {
        availabilityType?: string | null;
        businessHours?: Array<{
          day?: string;
          timeSlots?: Array<{ startTime?: string; endTime?: string }>;
        }> | null;
      } | null;
    } | null;
  };
  // staffMemberIds may be empty when the service is configured as "Anyone" —
  // in that case we use every staff member on the business (same as the real Bookings page).
  const explicitStaffIds = Array.isArray(svcJson.staffMemberIds) ? svcJson.staffMemberIds.filter(Boolean) : [];
  const anyoneMode = explicitStaffIds.length === 0;

  const durationMinutes = parseIso8601DurationMinutes(svcJson.defaultDuration ?? null) ?? 30;
  const durationMs = durationMinutes * 60_000;

  // timeSlotInterval controls how often slot start times are offered (scheduling granularity).
  // This is separate from the service duration. Default: 10 min per Graph docs.
  const granularityMinutes =
    parseIso8601DurationMinutes(svcJson.schedulingPolicy?.timeSlotInterval ?? null) ?? 10;
  const granularityMs = granularityMinutes * 60_000;

  // minimumLeadTime: slots within this window from now are hidden (can't book on short notice).
  const minimumLeadMs =
    (parseIso8601DurationMinutes(svcJson.schedulingPolicy?.minimumLeadTime ?? null) ?? 0) * 60_000;
  const earliestBookableMs = Date.now() + minimumLeadMs;

  // generalAvailability.businessHours: when availabilityType === "customWeeklyHours", these
  // define the booking window for this service (overrides individual staff working hours).
  // The Bookings page only offers slots within this window.
  const svcAvailability = svcJson.schedulingPolicy?.generalAvailability;
  const svcBusinessHours: Array<{ day?: string; timeSlots?: Array<{ startTime?: string; endTime?: string }> }> =
    svcAvailability?.availabilityType === "customWeeklyHours"
      ? (svcAvailability.businessHours ?? [])
      : [];

  // 2. Fetch staff members (for working hours, timezone, email).
  const staffResult = await graphFetch(`/solutions/bookingBusinesses/${bid}/staffMembers`);
  if (!staffResult.ok) return staffResult;

  const allStaff = ((staffResult.json as { value?: StaffMemberRaw[] }).value ?? [])
    .filter((s) => s.id && (anyoneMode || explicitStaffIds.includes(s.id)));

  if (allStaff.length === 0) return { ok: true, slots: [] };

  const startMs = Date.parse(args.startUtc);
  const endMs = Date.parse(args.endUtc);

  // 3. Try POST /me/calendar/getSchedule for true Outlook free/busy data.
  //    This is more accurate than calendarView because it reflects personal
  //    calendar events, OOO, and working-elsewhere blocks — not just Bookings
  //    appointments. Falls back to calendarView if the permission is missing.
  //
  //    availabilityViewInterval: 15 min → one char per 15 min starting at startUtc.
  //    '0' = free, '1' = tentative, '2' = busy, '3' = OOO, '4' = working elsewhere.
  //    We treat anything other than '0' as blocked.
  const INTERVAL_MIN = 15;
  const intervalMs = INTERVAL_MIN * 60_000;

  // email → availabilityView string (null if getSchedule not available)
  let scheduleMap: Map<string, string> | null = null;

  const staffEmails = allStaff.map((s) => s.emailAddress).filter(Boolean) as string[];
  if (staffEmails.length > 0) {
    // Graph expects dateTime without trailing 'Z', with timeZone specified separately.
    const dtStart = args.startUtc.replace("Z", "");
    const dtEnd = args.endUtc.replace("Z", "");
    const scheduleResult = await graphFetch("/me/calendar/getSchedule", {
      method: "POST",
      body: {
        schedules: staffEmails,
        startTime: { dateTime: dtStart, timeZone: "UTC" },
        endTime: { dateTime: dtEnd, timeZone: "UTC" },
        availabilityViewInterval: INTERVAL_MIN,
      },
    });
    if (scheduleResult.ok) {
      scheduleMap = new Map();
      const items = (
        (scheduleResult.json as { value?: Array<{ scheduleId?: string; availabilityView?: string }> })
          .value ?? []
      );
      for (const item of items) {
        if (item.scheduleId && item.availabilityView !== undefined) {
          scheduleMap.set(item.scheduleId.toLowerCase(), item.availabilityView);
        }
      }
      logger.info(
        { staffCount: allStaff.length, scheduleMapSize: scheduleMap.size },
        "Bookings: using getSchedule for free/busy",
      );
    } else {
      logger.warn(
        { status: scheduleResult.status, message: scheduleResult.message },
        "Bookings: getSchedule unavailable, falling back to calendarView",
      );
    }
  }

  // 4. If getSchedule failed, fall back to calendarView (Bookings appointments only).
  let appts: CalendarViewAppt[] = [];
  if (!scheduleMap) {
    const calViewResult = await graphFetch(
      `/solutions/bookingBusinesses/${bid}/calendarView` +
        `?start=${encodeURIComponent(args.startUtc)}&end=${encodeURIComponent(args.endUtc)}`,
    );
    if (!calViewResult.ok) return calViewResult;
    appts = (calViewResult.json as { value?: CalendarViewAppt[] }).value ?? [];
  }

  // Helper: check if a slot [slotStart, slotEnd) is free according to getSchedule data.
  function isSlotFreeInSchedule(slotStartMs: number, slotEndMs: number, view: string): boolean {
    const idxStart = Math.floor((slotStartMs - startMs) / intervalMs);
    const idxEnd = Math.ceil((slotEndMs - startMs) / intervalMs);
    for (let i = idxStart; i < idxEnd; i++) {
      const ch = view[i] ?? "2"; // treat missing as busy
      if (ch !== "0") return false;
    }
    return true;
  }

  // 5. Compute free slots.
  const byStart = new Map<string, GraphTimeSlot>();

  for (const staff of allStaff) {
    const staffId = staff.id!;
    const staffTz = resolveIana(staff.timeZone || args.fallbackTimezone);

    // Resolve availability view for this staff member (getSchedule path).
    const email = (staff.emailAddress ?? "").toLowerCase();
    const availView = scheduleMap?.get(email) ?? null;

    // Pre-compute booked windows for this staff member (calendarView fallback path).
    const bookedMs = appts
      .filter((a) => (a.staffMemberIds ?? []).includes(staffId))
      .map((a) => ({
        s: Date.parse(normaliseGraphDateTime(a.startDateTime) ?? ""),
        e: Date.parse(normaliseGraphDateTime(a.endDateTime) ?? ""),
      }))
      .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e));

    // Iterate through UTC calendar days in [startMs, endMs).
    let dayUtcMs = new Date(startMs);
    dayUtcMs.setUTCHours(0, 0, 0, 0);

    while (dayUtcMs.getTime() < endMs) {
      const dayMs = dayUtcMs.getTime();
      // Use noon UTC of this day to determine weekday in the staff's timezone.
      const noonMs = dayMs + 12 * 3600_000;
      const weekday = weekdayInTz(noonMs, staffTz);
      const localDate = localDateInTz(noonMs, staffTz);

      // Determine the time slots to use for this day.
      // Priority: service-level custom weekly hours (from schedulingPolicy.generalAvailability)
      // because the Bookings page uses those as the outer booking window.
      // Fall back to staff-level working hours when no service hours are defined.
      const svcDaySlots = svcBusinessHours.find(
        (wh) => (wh.day ?? "").toLowerCase() === weekday,
      )?.timeSlots ?? null;

      const staffDaySlots = (staff.workingHours ?? []).find(
        (wh) => (wh.day ?? "").toLowerCase() === weekday,
      )?.timeSlots ?? null;

      // When the service defines custom hours, intersect them with staff hours.
      // This ensures a slot is only offered if both the service window and the
      // staff member's personal working hours permit it.
      function intersectSlots(
        primarySlots: Array<{ startTime?: string; endTime?: string }>,
        secondarySlots: Array<{ startTime?: string; endTime?: string }> | null,
      ): Array<[number, number]> {
        // Convert to minutes-from-midnight pairs.
        const toMin = (hhmm: { h: number; m: number }) => hhmm.h * 60 + hhmm.m;
        const primary = primarySlots
          .map((ts) => [toMin(parseHHMM(ts.startTime ?? "")), toMin(parseHHMM(ts.endTime ?? ""))] as [number, number])
          .filter(([s, e]) => e > s);
        if (!secondarySlots) return primary;
        const secondary = secondarySlots
          .map((ts) => [toMin(parseHHMM(ts.startTime ?? "")), toMin(parseHHMM(ts.endTime ?? ""))] as [number, number])
          .filter(([s, e]) => e > s);
        const result: [number, number][] = [];
        for (const [ps, pe] of primary) {
          for (const [ss, se] of secondary) {
            const is = Math.max(ps, ss);
            const ie = Math.min(pe, se);
            if (ie > is) result.push([is, ie]);
          }
        }
        return result;
      }

      // Resolve the effective time windows for this day + staff member.
      const effectiveSlots: Array<[number, number]> =
        svcDaySlots !== null
          ? intersectSlots(svcDaySlots, staffDaySlots)
          : staffDaySlots !== null
            ? intersectSlots(staffDaySlots, null)
            : [];

      for (const [startMin, endMin] of effectiveSlots) {
        const startH = Math.floor(startMin / 60);
        const startM = startMin % 60;
        const endH = Math.floor(endMin / 60);
        const endMins = endMin % 60;

        const winStartMs = wallClockToUtcMs(dayMs, localDate, startH, startM, staffTz);
        const winEndMs = wallClockToUtcMs(dayMs, localDate, endH, endMins, staffTz);

        // Clip to the requested query window.
        const clampStart = Math.max(winStartMs, startMs);
        const clampEnd = Math.min(winEndMs, endMs);
        if (clampEnd <= clampStart + durationMs) continue;

        // Walk the window in granularity-sized steps (scheduling interval),
        // checking whether the full service duration fits and is free.
        for (let t = clampStart; t + durationMs <= clampEnd; t += granularityMs) {
          // Apply minimum lead time: hide slots too close to now.
          if (t < earliestBookableMs) continue;

          const slotEnd = t + durationMs;
          const blocked = availView !== null
            ? !isSlotFreeInSchedule(t, slotEnd, availView)
            : bookedMs.some((b) => t < b.e && slotEnd > b.s);
          if (blocked) continue;

          const slotStart = new Date(t).toISOString();
          const slotEndIso = new Date(slotEnd).toISOString();
          const existing = byStart.get(slotStart);
          if (existing) {
            if (!existing.staffIds.includes(staffId)) existing.staffIds.push(staffId);
          } else {
            byStart.set(slotStart, { startUtc: slotStart, endUtc: slotEndIso, staffIds: [staffId] });
          }
        }
      }

      dayUtcMs.setUTCDate(dayUtcMs.getUTCDate() + 1);
    }
  }

  const slots = [...byStart.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return { ok: true, slots };
}

export async function createAppointment(
  businessId: string,
  args: CreateAppointmentArgs,
): Promise<{ ok: true; appointmentId: string } | { ok: false; status: number; message: string }> {
  const staffIds = (args.staffMemberIds ?? []).filter(Boolean);
  const body = {
    "@odata.type": "#microsoft.graph.bookingAppointment",
    serviceId: args.serviceId,
    startDateTime: isoToGraphDateTime(args.startUtc),
    endDateTime: isoToGraphDateTime(args.endUtc),
    customerTimeZone: args.customerTimeZone,
    ...(staffIds.length > 0 ? { staffMemberIds: staffIds } : {}),
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
