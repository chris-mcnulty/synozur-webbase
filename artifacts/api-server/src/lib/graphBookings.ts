import { logger } from "./logger";

// Microsoft Graph Bookings client (app-only / client-credentials).
//
// Powers the "native" rendering mode for /start/{slug}: the api-server calls
// Graph on the visitor's behalf so we can render an on-brand React flow
// instead of Microsoft's iframe. Graph endpoints used:
//
//   GET  /solutions/bookingBusinesses/{id}                — business config
//   GET  /solutions/bookingBusinesses/{id}/services       — bookable services
//   POST /solutions/bookingBusinesses/{id}/getStaffAvailability
//   POST /solutions/bookingBusinesses/{id}/appointments   — create appointment
//
// Credentials are read from MS_BOOKINGS_* env vars and fall back to the
// existing ENTRA_* app registration. The app registration must hold the
// `Bookings.ReadWrite.All` application permission with admin consent.
//
// Token cache is per-tenant (matching entra.ts) so a separate Bookings tenant
// doesn't evict other Graph tokens. The cache lives in-process; a multi-node
// deployment will fetch one token per node which is fine for these volumes.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface AppTokenCache {
  token: string;
  expiresAt: number;
}

const appTokenCacheByTenant = new Map<string, AppTokenCache>();

function bookingsTenantId(): string | null {
  return process.env["MS_BOOKINGS_TENANT_ID"] ?? process.env["ENTRA_TENANT_ID"] ?? null;
}

function bookingsClientId(): string | null {
  return process.env["MS_BOOKINGS_CLIENT_ID"] ?? process.env["ENTRA_APP_CLIENT_ID"] ?? null;
}

function bookingsClientSecret(): string | null {
  return (
    process.env["MS_BOOKINGS_CLIENT_SECRET"] ??
    process.env["ENTRA_CLIENT_SECRET"] ??
    process.env["ENTRA_APP_CLIENT_SECRET"] ??
    null
  );
}

export function isGraphBookingsConfigured(): boolean {
  return Boolean(bookingsTenantId() && bookingsClientId() && bookingsClientSecret());
}

async function getToken(): Promise<string | null> {
  const tenantId = bookingsTenantId();
  const clientId = bookingsClientId();
  const clientSecret = bookingsClientSecret();
  if (!tenantId || !clientId || !clientSecret) return null;

  const now = Date.now();
  const cached = appTokenCacheByTenant.get(tenantId);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  try {
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      logger.warn(
        { status: res.status, body: text, tenantId },
        "Bookings Graph token fetch failed",
      );
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    appTokenCacheByTenant.set(tenantId, {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    });
    return json.access_token;
  } catch (err) {
    logger.warn({ err, tenantId }, "Bookings Graph token fetch threw");
    return null;
  }
}

/** Thin wrapper around fetch that injects the bearer token and parses JSON. */
async function graphFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const token = await getToken();
  if (!token) {
    return { ok: false, status: 503, message: "Bookings Graph credentials are not configured." };
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
    // Surface a sanitized message — Graph error bodies often contain
    // enough detail to leak business config; collapse to status-class hints.
    if (res.status === 404) return { ok: false, status: 404, message: "Booking calendar not found." };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 502, message: "Bookings provider rejected our credentials." };
    }
    return { ok: false, status: 502, message: "Bookings provider returned an error." };
  }
  const json = (await res.json()) as unknown;
  return { ok: true, json };
}

// ---------------------------------------------------------------------------
// Public API
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
  // Graph expects { dateTime: "yyyy-MM-ddTHH:mm:ss(.fff)", timeZone: "UTC" }
  // Strip any trailing Z so the dateTime field is naive.
  const stripped = iso.endsWith("Z") ? iso.slice(0, -1) : iso;
  return { dateTime: stripped, timeZone: "UTC" };
}

function dateTimeToUtcIso(dt: { dateTime?: string; timeZone?: string } | undefined): string | null {
  // We always pass timeZone="UTC" on the way in, so on the way back we expect
  // the same. If a tenant returns a different zone, fall back to treating it
  // as UTC — the visitor sees a slot that's an hour off rather than a 500.
  if (!dt?.dateTime) return null;
  const hasZ = dt.dateTime.endsWith("Z");
  return hasZ ? dt.dateTime : `${dt.dateTime}Z`;
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
  // First we need the service so we can pass its staff list to
  // getStaffAvailability — without staffIds Graph returns an empty result.
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

  // Flatten per-staff availability into a deduplicated slot list. Two staff
  // with the same available window collapse into one selectable slot, but
  // we keep both staff IDs so the appointment can pin to one of them.
  const byStart = new Map<string, GraphTimeSlot>();
  for (const staff of j.value ?? []) {
    const staffId = staff.staffId;
    if (!staffId) continue;
    for (const item of staff.availabilityItems ?? []) {
      if (item.status !== "available") continue;
      const startUtc = dateTimeToUtcIso(item.startDateTime);
      const endUtc = dateTimeToUtcIso(item.endDateTime);
      if (!startUtc || !endUtc) continue;
      // Slice "available" windows into duration-sized slots.
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
