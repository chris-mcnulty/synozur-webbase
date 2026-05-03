// #127 Phase 2 — low-level Microsoft Graph client for SharePoint Embedded.
//
// Responsibilities (mirrors the role of `sharepoint-graph-client.ts` in
// Synozur Orbit, single-tenant edition for this site):
//   • Acquire and cache an app-only access token via MSAL Confidential
//     Client (one tenant, no per-customer map).
//   • Resolve a container's drive ID once and cache it for 5 minutes —
//     SPE requires `/drives/{driveId}/...` for all item operations.
//   • Wrap fetch() with retry/backoff: 429 honors Retry-After, 5xx
//     exponential with jitter (max 3, capped at 30 s), 4xx no retry.
//   • Provide the file primitives the higher-level fileStorage layer
//     needs: small upload, resumable upload, download → Response,
//     delete, list.
//
// Auth credentials are read from env (ENTRA_TENANT_ID,
// ENTRA_APP_CLIENT_ID, ENTRA_APP_CLIENT_SECRET — same names already used
// by lib/entra.ts; ENTRA_CLIENT_SECRET is also accepted as an alias).
// Container IDs and the container-type ID live in `site_settings` and are
// resolved by the caller in fileStorage.ts, not here.

import { ConfidentialClientApplication } from "@azure/msal-node";
import { logger } from "../../logger";

const GRAPH_V1_URL = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA_URL = "https://graph.microsoft.com/beta";

const DRIVE_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const SMALL_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB — Graph's simple upload cap
const RESUMABLE_CHUNK_BYTES = 5 * 1024 * 1024;     // 5 MB chunks for upload sessions
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_CAP_MS = 30_000;

interface DriveIdCacheEntry {
  driveId: string;
  expiresAt: number;
}

export interface SpeGraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface SpeFileItem {
  id: string;                           // drive item id
  name: string;
  size: number;
  contentType: string;
  // Drive items can be either files or folders; the listing endpoints
  // return both. Callers iterating `listChildren()` need this so they
  // don't accidentally treat a folder like a file (e.g. orphan cleanup
  // attempting to delete a `/media` folder thinking it's a stray asset).
  kind: "file" | "folder";
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  fields?: Record<string, unknown>;
}

// Custom column definition for SPE container schemas. Mirrors the Microsoft
// Graph `columnDefinition` resource exposed at
// `/storage/fileStorage/containers/{id}/columns` — the SPE-specific endpoint
// that, unlike `/drives/{id}/list/columns`, *does* permit schema modification
// against an SPE container site with app-only Container.Selected/FullControl.
export type SpeColumnType =
  | "text"
  | "choice"
  | "dateTime"
  | "number"
  | "currency"
  | "boolean"
  | "personOrGroup"
  | "hyperlinkOrPicture";

export interface SpeColumnDefinition {
  /** Returned by Graph after creation. */
  id?: string;
  /** Internal name — must match ^[a-zA-Z][a-zA-Z0-9_]*$. Immutable once created. */
  name: string;
  /** Human-readable label shown in the SharePoint portal. */
  displayName: string;
  description?: string;
  columnType: SpeColumnType;
  required?: boolean;
  /** Indexed columns can be filtered with `$filter` against listItem.fields. */
  indexed?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  enforceUniqueValues?: boolean;
  text?: {
    allowMultipleLines?: boolean;
    appendChangesToExistingText?: boolean;
    linesForEditing?: number;
    /** SharePoint hard-caps single-line text at 255 characters. */
    maxLength?: number;
  };
  choice?: {
    choices: string[];
    allowFillInChoice?: boolean;
    displayAs?: "dropDownMenu" | "radioButtons" | "checkboxes";
  };
  dateTime?: {
    displayAs?: "default" | "friendly" | "standard";
    format?: "dateOnly" | "dateTime";
  };
  number?: {
    /** 0–5; mapped to Graph's string enum ("none"|"one"|...|"five"). */
    decimalPlaces?: number;
    minimum?: number;
    maximum?: number;
  };
  currency?: {
    /** Locale identifier — 1033 = en-US, 2057 = en-GB, 2052 = zh-CN, 3082 = es-ES, etc. */
    lcid?: number;
  };
  boolean?: Record<string, never>;
  personOrGroup?: {
    allowMultipleSelection?: boolean;
    chooseFromType?: "peopleOnly" | "peopleAndGroups";
  };
  hyperlinkOrPicture?: {
    isPicture?: boolean;
  };
}

const NUMBER_DECIMAL_MAP: Record<number, string> = {
  0: "none",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
};

/** SharePoint hard-caps single-line text columns at 255 chars. */
const TEXT_MAX_LENGTH_CAP = 255;

/** Translates a `SpeColumnDefinition` into the Graph wire shape. */
function buildColumnRequest(
  col: SpeColumnDefinition,
): Record<string, unknown> {
  const req: Record<string, unknown> = {
    name: col.name,
    displayName: col.displayName,
    description: col.description ?? "",
    required: col.required ?? false,
    indexed: col.indexed ?? false,
    hidden: col.hidden ?? false,
    readOnly: col.readOnly ?? false,
    enforceUniqueValues: col.enforceUniqueValues ?? false,
  };
  switch (col.columnType) {
    case "text":
      req["text"] = {
        allowMultipleLines: col.text?.allowMultipleLines ?? false,
        appendChangesToExistingText: col.text?.appendChangesToExistingText ?? false,
        linesForEditing: col.text?.linesForEditing ?? 0,
        maxLength: Math.min(col.text?.maxLength ?? TEXT_MAX_LENGTH_CAP, TEXT_MAX_LENGTH_CAP),
      };
      break;
    case "choice":
      if (!col.choice || !col.choice.choices?.length) {
        throw new Error(`Choice column "${col.name}" requires non-empty choices[]`);
      }
      req["choice"] = {
        choices: col.choice.choices,
        allowFillInChoice: col.choice.allowFillInChoice ?? false,
        displayAs: col.choice.displayAs ?? "dropDownMenu",
      };
      break;
    case "dateTime":
      req["dateTime"] = {
        displayAs: col.dateTime?.displayAs ?? "default",
        format: col.dateTime?.format ?? "dateTime",
      };
      break;
    case "number": {
      const dp = col.number?.decimalPlaces;
      const number: Record<string, unknown> = {
        decimalPlaces: dp != null ? NUMBER_DECIMAL_MAP[dp] ?? "automatic" : "automatic",
      };
      if (col.number?.minimum != null) number["minimum"] = col.number.minimum;
      if (col.number?.maximum != null) number["maximum"] = col.number.maximum;
      req["number"] = number;
      break;
    }
    case "currency":
      req["currency"] = { lcid: col.currency?.lcid ?? 1033 };
      break;
    case "boolean":
      req["boolean"] = {};
      break;
    case "personOrGroup":
      req["personOrGroup"] = {
        allowMultipleSelection: col.personOrGroup?.allowMultipleSelection ?? false,
        chooseFromType: col.personOrGroup?.chooseFromType ?? "peopleOnly",
      };
      break;
    case "hyperlinkOrPicture":
      req["hyperlinkOrPicture"] = { isPicture: col.hyperlinkOrPicture?.isPicture ?? false };
      break;
  }
  return req;
}

export class SpeGraphConfigMissingError extends Error {
  constructor() {
    super(
      "SharePoint Embedded credentials missing — set ENTRA_TENANT_ID, " +
        "ENTRA_APP_CLIENT_ID, and ENTRA_APP_CLIENT_SECRET (or ENTRA_CLIENT_SECRET).",
    );
    this.name = "SpeGraphConfigMissingError";
    Object.setPrototypeOf(this, SpeGraphConfigMissingError.prototype);
  }
}

export class SpeGraphRequestError extends Error {
  readonly status: number;
  readonly bodyExcerpt: string;
  constructor(message: string, status: number, bodyExcerpt: string) {
    super(message);
    this.name = "SpeGraphRequestError";
    this.status = status;
    this.bodyExcerpt = bodyExcerpt;
    Object.setPrototypeOf(this, SpeGraphRequestError.prototype);
  }
}

export function readSpeGraphConfigFromEnv(): SpeGraphConfig | null {
  const tenantId = process.env["ENTRA_TENANT_ID"];
  const clientId = process.env["ENTRA_APP_CLIENT_ID"];
  const clientSecret =
    process.env["ENTRA_APP_CLIENT_SECRET"] ?? process.env["ENTRA_CLIENT_SECRET"];
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

export class SpeGraphClient {
  private readonly msal: ConfidentialClientApplication;
  private readonly driveIdCache = new Map<string, DriveIdCacheEntry>();

  constructor(config?: SpeGraphConfig) {
    const resolved = config ?? readSpeGraphConfigFromEnv();
    if (!resolved) {
      throw new SpeGraphConfigMissingError();
    }
    this.msal = new ConfidentialClientApplication({
      auth: {
        clientId: resolved.clientId,
        clientSecret: resolved.clientSecret,
        authority: `https://login.microsoftonline.com/${resolved.tenantId}`,
      },
    });
  }

  private async getAccessToken(): Promise<string> {
    const result = await this.msal.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    if (!result?.accessToken) {
      throw new Error("MSAL returned no access token for client credentials grant");
    }
    return result.accessToken;
  }

  // Wraps fetch() with auth, retry, and Graph-flavored error decoding.
  // `init.body` may be a Buffer/Readable/string; passes through to fetch().
  async request<T>(
    url: string,
    init: RequestInit & { skipJsonParse?: boolean } = {},
  ): Promise<T> {
    const { skipJsonParse, ...fetchInit } = init;
    const response = await this.fetchWithRetry(url, fetchInit);
    if (skipJsonParse) {
      return response as unknown as T;
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  // Returns the raw Response for streaming body access (downloads).
  async requestRaw(url: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchWithRetry(url, init);
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    attempt = 1,
  ): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (err) {
      if (attempt >= RETRY_MAX_ATTEMPTS) throw err;
      const wait = backoffMs(attempt);
      logger.warn(
        { err, url, attempt, wait },
        "SPE Graph fetch threw — retrying after network error",
      );
      await sleep(wait);
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    if (response.ok) return response;

    if (response.status === 429 && attempt < RETRY_MAX_ATTEMPTS) {
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      const wait = jitter(Math.min(retryAfter ?? backoffMs(attempt), RETRY_BACKOFF_CAP_MS));
      logger.warn({ url, status: 429, wait, attempt }, "SPE Graph 429 — backing off");
      await sleep(wait);
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    if (response.status >= 500 && attempt < RETRY_MAX_ATTEMPTS) {
      const wait = backoffMs(attempt);
      logger.warn(
        { url, status: response.status, wait, attempt },
        "SPE Graph 5xx — retrying",
      );
      await sleep(wait);
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    // 4xx (other than 429) and exhausted retries fall through to a typed error.
    const bodyExcerpt = (await response.text().catch(() => "")).slice(0, 500);
    throw new SpeGraphRequestError(
      `SPE Graph ${response.status} on ${init.method ?? "GET"} ${url}`,
      response.status,
      bodyExcerpt,
    );
  }

  // SPE requires resolving the container's drive id before file ops.
  // Cached per containerId for 5 minutes.
  async getContainerDriveId(containerId: string): Promise<string> {
    const cached = this.driveIdCache.get(containerId);
    if (cached && cached.expiresAt > Date.now()) return cached.driveId;
    const data = await this.request<{ id: string }>(
      `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/drive`,
    );
    if (!data?.id) {
      throw new Error(`SPE container ${containerId} returned no drive id`);
    }
    this.driveIdCache.set(containerId, {
      driveId: data.id,
      expiresAt: Date.now() + DRIVE_ID_CACHE_TTL_MS,
    });
    return data.id;
  }

  // Path-based small upload (≤4 MB). Path is the in-container path
  // ("folder/sub/name.png"); leading slash optional.
  async uploadSmall(
    containerId: string,
    path: string,
    body: Buffer,
    contentType: string,
  ): Promise<SpeFileItem> {
    if (body.length > SMALL_UPLOAD_LIMIT_BYTES) {
      throw new Error(
        `uploadSmall called with ${body.length} bytes; limit is ${SMALL_UPLOAD_LIMIT_BYTES}.`,
      );
    }
    const driveId = await this.getContainerDriveId(containerId);
    const safePath = encodePath(path);
    const url = `${GRAPH_V1_URL}/drives/${driveId}/root:${safePath}:/content`;
    const item = await this.request<RawDriveItem>(url, {
      method: "PUT",
      body,
      headers: { "Content-Type": contentType },
    });
    return toSpeFileItem(item);
  }

  // Resumable upload (>4 MB). Streams chunks of RESUMABLE_CHUNK_BYTES.
  async uploadResumable(
    containerId: string,
    path: string,
    body: Buffer,
    // Resumable upload chunks set Content-Range/Length per chunk, not a
    // Content-Type for the item. Kept in the signature so callers stay
    // symmetric with `uploadSimple`; prefixed `_` to mark intentionally
    // unused.
    _contentType: string,
  ): Promise<SpeFileItem> {
    const driveId = await this.getContainerDriveId(containerId);
    const safePath = encodePath(path);
    const sessionUrl = `${GRAPH_V1_URL}/drives/${driveId}/root:${safePath}:/createUploadSession`;
    const session = await this.request<{ uploadUrl: string }>(sessionUrl, {
      method: "POST",
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "replace", name: basename(path) },
      }),
      headers: { "Content-Type": "application/json" },
    });
    if (!session.uploadUrl) {
      throw new Error("createUploadSession returned no uploadUrl");
    }

    const total = body.length;
    let offset = 0;
    let lastResponse: RawDriveItem | undefined;
    while (offset < total) {
      const end = Math.min(offset + RESUMABLE_CHUNK_BYTES, total);
      const chunk = body.subarray(offset, end);
      // Upload-session PUTs are NOT auth-required (the URL itself is the token)
      // and must NOT use fetchWithRetry's auth header injection. Use plain fetch.
      const res = await fetch(session.uploadUrl, {
        method: "PUT",
        body: chunk,
        headers: {
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
        },
      });
      if (!res.ok && res.status !== 202) {
        const excerpt = (await res.text().catch(() => "")).slice(0, 500);
        throw new SpeGraphRequestError(
          `SPE upload session chunk failed (offset ${offset})`,
          res.status,
          excerpt,
        );
      }
      // 200/201 on the final chunk returns the DriveItem; 202 on intermediate.
      if (res.status === 200 || res.status === 201) {
        lastResponse = (await res.json()) as RawDriveItem;
      }
      offset = end;
    }
    if (!lastResponse) {
      throw new Error("Resumable upload completed without a final DriveItem response");
    }
    return toSpeFileItem(lastResponse);
  }

  // Caller chooses path; size determines simple vs resumable.
  uploadFile(
    containerId: string,
    path: string,
    body: Buffer,
    contentType: string,
  ): Promise<SpeFileItem> {
    return body.length <= SMALL_UPLOAD_LIMIT_BYTES
      ? this.uploadSmall(containerId, path, body, contentType)
      : this.uploadResumable(containerId, path, body, contentType);
  }

  async downloadFile(containerId: string, itemId: string): Promise<Response> {
    const driveId = await this.getContainerDriveId(containerId);
    return this.requestRaw(`${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}/content`);
  }

  // Mint a short-lived, tokenized embed URL for the M365 web viewer.
  // This is the canonical Graph "preview" action — it returns a URL
  // distinct from the canonical SharePoint webUrl, scoped to a single
  // viewing session, so customers never receive the raw item webUrl.
  // Docs: https://learn.microsoft.com/en-us/graph/api/driveitem-preview
  async getPreviewUrl(
    containerId: string,
    itemId: string,
  ): Promise<{ getUrl: string | null; postUrl: string | null }> {
    const driveId = await this.getContainerDriveId(containerId);
    const data = await this.request<{
      getUrl?: string;
      postUrl?: string;
    }>(`${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    return {
      getUrl: data.getUrl ?? null,
      postUrl: data.postUrl ?? null,
    };
  }

  async getItem(containerId: string, itemId: string): Promise<SpeFileItem> {
    const driveId = await this.getContainerDriveId(containerId);
    const item = await this.request<RawDriveItem>(
      `${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}?$expand=listItem($expand=fields)`,
    );
    return toSpeFileItem(item);
  }

  // #243 — List historical versions of a driveItem. SharePoint Embedded
  // retains versions natively per its versioning policy; each entry has
  // a label (e.g. "1.0", "2.0", "3.0"), the timestamp it was committed,
  // its byte size, and (when populated) the displayName of the user who
  // committed it. The newest entry corresponds to the current driveItem
  // and shares its size/lastModified.
  async listItemVersions(
    containerId: string,
    itemId: string,
  ): Promise<RawDriveItemVersion[]> {
    const driveId = await this.getContainerDriveId(containerId);
    let url: string =
      `${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}/versions` +
      `?$select=id,lastModifiedDateTime,size,lastModifiedBy`;
    const out: RawDriveItemVersion[] = [];
    while (url) {
      const page = await this.request<{
        value: RawDriveItemVersion[];
        "@odata.nextLink"?: string;
      }>(url);
      for (const v of page.value ?? []) out.push(v);
      url = page["@odata.nextLink"] ?? "";
    }
    return out;
  }

  // #243 — Stream the bytes for one historical version. Graph exposes
  // `/versions/{versionId}/content` with the same shape as the live
  // item's content endpoint.
  async downloadItemVersion(
    containerId: string,
    itemId: string,
    versionId: string,
  ): Promise<Response> {
    const driveId = await this.getContainerDriveId(containerId);
    return this.requestRaw(
      `${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}/versions/${encodeURIComponent(
        versionId,
      )}/content`,
    );
  }

  async deleteItem(containerId: string, itemId: string): Promise<void> {
    const driveId = await this.getContainerDriveId(containerId);
    await this.request<void>(`${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}`, {
      method: "DELETE",
      skipJsonParse: true,
    });
  }

  async listChildren(
    containerId: string,
    folderPath = "/",
  ): Promise<SpeFileItem[]> {
    const driveId = await this.getContainerDriveId(containerId);
    const safePath = encodePath(folderPath);
    // Explicitly select the fields we need so Graph doesn't drop them in
    // SPE contexts where the default projection may differ from personal/
    // business OneDrive. Without $select, `createdDateTime` can be absent
    // which causes the orphan scanner to treat every item as "too young".
    const select = "$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder";
    let url =
      safePath === "/" || safePath === ""
        ? `${GRAPH_V1_URL}/drives/${driveId}/root/children?${select}&$expand=listItem($expand=fields)`
        : `${GRAPH_V1_URL}/drives/${driveId}/root:${safePath}:/children?${select}&$expand=listItem($expand=fields)`;
    const items: SpeFileItem[] = [];
    while (url) {
      const page = await this.request<{ value: RawDriveItem[]; "@odata.nextLink"?: string }>(url);
      for (const item of page.value ?? []) items.push(toSpeFileItem(item));
      url = page["@odata.nextLink"] ?? "";
    }
    return items;
  }

  // Stamp arbitrary list-item field metadata onto a DriveItem.
  // Backend code uses this to record provenance (uploadedByUserId,
  // documentType, original filename, etc.) on the SharePoint item.
  // Custom columns must be provisioned on the container schema first via
  // `createContainerColumn` (or the bulk initializer); built-in columns
  // (e.g. Title, description) are always writable.
  //
  // Bulk PATCH first; if Graph rejects the batch because at least one
  // column doesn't exist on the schema yet, retry field-by-field so the
  // recognized fields still land. In the per-field retry, only "column
  // does not exist on the schema" errors are swallowed — other validation
  // failures (value too long, wrong type, invalid choice) are logged at
  // warn level so they surface in observability rather than silently
  // dropping data.
  async setItemFields(
    containerId: string,
    itemId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    const driveId = await this.getContainerDriveId(containerId);
    const endpoint = `${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}/listItem/fields`;
    try {
      await this.request<void>(endpoint, {
        method: "PATCH",
        body: JSON.stringify(fields),
        headers: { "Content-Type": "application/json" },
        skipJsonParse: true,
      });
      return;
    } catch (err) {
      // Graph 400/422 for missing/unknown columns — fall back to per-field.
      if (
        !(err instanceof SpeGraphRequestError) ||
        (err.status !== 400 && err.status !== 422)
      ) {
        throw err;
      }
      logger.warn(
        { itemId, status: err.status, bodyExcerpt: err.bodyExcerpt },
        "SPE bulk field PATCH rejected; retrying per-field",
      );
    }
    for (const [key, value] of Object.entries(fields)) {
      try {
        await this.request<void>(endpoint, {
          method: "PATCH",
          body: JSON.stringify({ [key]: value }),
          headers: { "Content-Type": "application/json" },
          skipJsonParse: true,
        });
      } catch (err) {
        if (
          err instanceof SpeGraphRequestError &&
          (err.status === 400 || err.status === 422)
        ) {
          if (isUnknownColumnError(err.bodyExcerpt)) {
            logger.debug({ itemId, key }, "SPE field skipped — column not on schema");
            continue;
          }
          // Other validation failure — value too long, type mismatch,
          // invalid choice value, etc. Don't fail the upload (metadata
          // is best-effort) but log loudly so it surfaces in monitoring.
          logger.warn(
            { itemId, key, status: err.status, bodyExcerpt: err.bodyExcerpt },
            "SPE field PATCH rejected (validation error); value not stamped",
          );
          continue;
        }
        throw err;
      }
    }
  }

  // ----- Custom column management -----------------------------------------
  // All column endpoints are SPE-specific:
  //   /storage/fileStorage/containers/{containerId}/columns
  // The drive-scoped endpoint `/drives/{driveId}/list/columns` 403s on SPE
  // containers regardless of permission level — use these container-scoped
  // calls instead.

  async createContainerColumn(
    containerId: string,
    column: SpeColumnDefinition,
  ): Promise<SpeColumnDefinition> {
    const body = buildColumnRequest(column);
    return this.request<SpeColumnDefinition>(
      `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/columns`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  async listContainerColumns(containerId: string): Promise<SpeColumnDefinition[]> {
    const url = `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/columns`;
    const all: SpeColumnDefinition[] = [];
    let next: string | undefined = url;
    while (next) {
      const page: { value?: SpeColumnDefinition[]; "@odata.nextLink"?: string } =
        await this.request(next);
      for (const c of page.value ?? []) all.push(c);
      next = page["@odata.nextLink"];
    }
    return all;
  }

  async getContainerColumn(
    containerId: string,
    columnId: string,
  ): Promise<SpeColumnDefinition> {
    return this.request<SpeColumnDefinition>(
      `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/columns/${columnId}`,
    );
  }

  // Graph only honors a small subset of properties on PATCH:
  // displayName, description, required, hidden. Other fields are ignored.
  async updateContainerColumn(
    containerId: string,
    columnId: string,
    updates: Partial<
      Pick<SpeColumnDefinition, "displayName" | "description" | "required" | "hidden">
    >,
  ): Promise<SpeColumnDefinition> {
    return this.request<SpeColumnDefinition>(
      `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/columns/${columnId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  async deleteContainerColumn(containerId: string, columnId: string): Promise<void> {
    await this.request<void>(
      `${GRAPH_V1_URL}/storage/fileStorage/containers/${containerId}/columns/${columnId}`,
      {
        method: "DELETE",
        skipJsonParse: true,
      },
    );
  }

  // Sets DriveItem-level properties (e.g. `description`) directly on the
  // item — distinct from list-item field columns. The description is a
  // built-in DriveItem property that requires no column creation, is
  // indexed by Microsoft Search, and is surfaced to Copilot.
  async patchItem(
    containerId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const driveId = await this.getContainerDriveId(containerId);
    await this.request<void>(
      `${GRAPH_V1_URL}/drives/${driveId}/items/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
        headers: { "Content-Type": "application/json" },
        skipJsonParse: true,
      },
    );
  }

  // Used by containerCreator for container-type registration. PUT against
  // the beta endpoint — the only place we still need /beta.
  betaUrl(path: string): string {
    return `${GRAPH_BETA_URL}${path}`;
  }
  v1Url(path: string): string {
    return `${GRAPH_V1_URL}${path}`;
  }
}

// Microsoft Graph `driveItemVersion` shape (subset we use).
export interface RawDriveItemVersion {
  id: string;
  lastModifiedDateTime?: string;
  size?: number;
  lastModifiedBy?: {
    user?: { displayName?: string; email?: string; id?: string };
  };
}

interface RawDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  // Graph populates exactly one of `file` / `folder` to discriminate.
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  listItem?: { fields?: Record<string, unknown> };
}

function toSpeFileItem(raw: RawDriveItem): SpeFileItem {
  const kind: "file" | "folder" = raw.folder ? "folder" : "file";
  return {
    id: raw.id,
    name: raw.name,
    size: raw.size ?? 0,
    contentType:
      kind === "folder"
        ? "inode/directory"
        : raw.file?.mimeType ?? "application/octet-stream",
    kind,
    webUrl: raw.webUrl,
    createdDateTime: raw.createdDateTime,
    lastModifiedDateTime: raw.lastModifiedDateTime,
    fields: raw.listItem?.fields,
  };
}

function encodePath(path: string): string {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return trimmed
    .split("/")
    .map((seg) => (seg ? encodeURIComponent(seg) : ""))
    .join("/");
}

function basename(path: string): string {
  const trimmed = path.split("?")[0]!;
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// Graph reports a missing list-item field with a few different phrasings
// depending on the surface (SharePoint REST under the hood, SPE wrapper,
// older list runtime). Match on phrases that unambiguously mean "this
// column doesn't exist on the schema" — anything else (value too long,
// type mismatch, choice not in the allowed set) is a real validation
// failure and must not be swallowed.
const UNKNOWN_COLUMN_PATTERNS = [
  /column ['"`].+?['"`] does not exist/i,
  /field ['"`].+?['"`] does not exist/i,
  /does not exist on .* list/i,
  /property ['"`].+?['"`] does not exist on type/i,
  /no column with name/i,
  /column not found/i,
  /unrecognized field/i,
  /invalid field name/i,
];

function isUnknownColumnError(bodyExcerpt: string): boolean {
  return UNKNOWN_COLUMN_PATTERNS.some((re) => re.test(bodyExcerpt));
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, … capped.
  const base = Math.min(2 ** (attempt - 1) * 1000, RETRY_BACKOFF_CAP_MS);
  return jitter(base);
}

function jitter(ms: number): number {
  // ±30% jitter so retries don't synchronise across processes.
  const span = ms * 0.3;
  return Math.round(ms + (Math.random() * 2 - 1) * span);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
