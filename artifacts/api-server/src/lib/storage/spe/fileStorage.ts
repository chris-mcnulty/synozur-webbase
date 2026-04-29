// #127 Phase 2 — high-level SPE file ops, single-tenant.
//
// Resolves the active container from `site_settings.spe_container_id_dev`
// vs `spe_container_id_prod` (picked by NODE_ENV) and delegates the
// actual Graph work to `SpeGraphClient`. The folder layout under the
// container is fixed here — same shape Orbit uses but trimmed to what
// the Synozur marketing site actually produces:
//
//   /media/<id-prefix>/<filename>            ← media library uploads
//   /attachments/<id-prefix>/<filename>      ← post / artifact attachments
//
// Callers don't need to know the folder convention; they pass a
// `documentType` and the entity id and we build the path. The drive item
// id that comes back is what the calling code persists into the DB
// (`media.spe_file_id` once the schema overlay lands in Phase 3).

import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import { logger } from "../../logger";
import { SpeGraphClient, SpeFileItem, readSpeGraphConfigFromEnv } from "./graphClient";

const SETTINGS_ID = 1;

export class SpeNotEnabledError extends Error {
  constructor(reason: string) {
    super(`SharePoint Embedded backend is not enabled: ${reason}`);
    this.name = "SpeNotEnabledError";
    Object.setPrototypeOf(this, SpeNotEnabledError.prototype);
  }
}

export type SpeDocumentType = "media" | "attachment";

export interface StoreFileOptions {
  body: Buffer;
  filename: string;
  contentType: string;
  documentType: SpeDocumentType;
  // Used to scatter files across folders so a container with millions of
  // items doesn't end up with one giant directory. Caller passes the
  // primary key of the owning row (e.g. `media.id` UUID); we use the
  // first two characters as the folder prefix.
  ownerId: string;
  // Optional metadata stamped onto the SharePoint list item for audit
  // and orphan-cleanup. Stored as `Synozur*` columns; admins can query
  // them from SharePoint admin UIs.
  uploadedByUserId?: string;
  // Arbitrary additional fields to stamp; merged into the metadata patch.
  extraFields?: Record<string, unknown>;
}

export interface StoredFile {
  containerId: string;
  itemId: string;
  size: number;
  contentType: string;
  webUrl?: string;
}

export class SpeFileStorage {
  private graph: SpeGraphClient | null = null;

  // Lazy — constructing the MSAL client throws if env vars aren't set,
  // and we want callers (the storage backend factory, the admin status
  // route) to be able to instantiate this class without exploding when
  // SPE isn't configured yet.
  private getGraph(): SpeGraphClient {
    if (!this.graph) {
      const cfg = readSpeGraphConfigFromEnv();
      if (!cfg) {
        throw new SpeNotEnabledError(
          "Entra credentials missing (ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID / ENTRA_APP_CLIENT_SECRET)",
        );
      }
      this.graph = new SpeGraphClient(cfg);
    }
    return this.graph;
  }

  // For the admin "create container" flow, callers want a graph client
  // with the configured app credentials but don't yet have a container.
  // Expose it so the route handler can construct an SpeContainerCreator.
  graphClient(): SpeGraphClient {
    return this.getGraph();
  }

  async resolveContainerId(): Promise<string> {
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, SETTINGS_ID),
    });
    if (!settings) {
      throw new SpeNotEnabledError("site_settings row not initialised");
    }
    if (!settings.speStorageEnabled) {
      throw new SpeNotEnabledError("speStorageEnabled is false in site_settings");
    }
    const isProd = process.env["NODE_ENV"] === "production";
    const containerId = isProd
      ? settings.speContainerIdProd
      : settings.speContainerIdDev;
    if (!containerId) {
      throw new SpeNotEnabledError(
        `no SPE container configured for ${isProd ? "production" : "non-production"} (set spe_container_id_${isProd ? "prod" : "dev"} via the SPE admin page)`,
      );
    }
    return containerId;
  }

  async storeFile(opts: StoreFileOptions): Promise<StoredFile> {
    const containerId = await this.resolveContainerId();
    const path = buildPath(opts.documentType, opts.ownerId, opts.filename);
    const item = await this.getGraph().uploadFile(
      containerId,
      path,
      opts.body,
      opts.contentType,
    );
    const fields = buildMetadataFields(opts);
    if (Object.keys(fields).length > 0) {
      try {
        await this.getGraph().setItemFields(containerId, item.id, fields);
      } catch (err) {
        // Don't fail the whole upload if metadata stamping flakes; log
        // and continue — the file is up, the orphan cleaner can recover
        // missing-metadata items later.
        logger.warn(
          { err, itemId: item.id, fields },
          "SPE metadata stamping failed; file uploaded without fields",
        );
      }
    }
    return {
      containerId,
      itemId: item.id,
      size: item.size,
      contentType: item.contentType,
      webUrl: item.webUrl,
    };
  }

  // Reads/deletes accept an optional explicit containerId so callers
  // (the storage route, the cms/media DELETE handler) can target the
  // container that originally stored the item — recorded on
  // `media.spe_container_id`. Falls back to the active container when
  // omitted, which is the right thing for the migration script and
  // any caller that just wrote a fresh item.
  async getFile(itemId: string, containerIdOverride?: string): Promise<Response> {
    const containerId = containerIdOverride ?? (await this.resolveContainerId());
    return this.getGraph().downloadFile(containerId, itemId);
  }

  async deleteFile(itemId: string, containerIdOverride?: string): Promise<void> {
    const containerId = containerIdOverride ?? (await this.resolveContainerId());
    await this.getGraph().deleteItem(containerId, itemId);
  }

  // Recursive walk that returns ONLY files (folders are traversed but
  // not emitted). The previous shallow listing returned the root
  // container's direct children — folders like `/media` and
  // `/attachment` rather than the actual files underneath. Orphan
  // cleanup needs the leaf set, not the folder structure.
  async listFiles(documentType?: SpeDocumentType): Promise<SpeFileItem[]> {
    const containerId = await this.resolveContainerId();
    const folder = documentType ? `/${documentType}` : "/";
    return this.recurseFiles(containerId, folder);
  }

  private async recurseFiles(
    containerId: string,
    folder: string,
  ): Promise<SpeFileItem[]> {
    const children = await this.getGraph().listChildren(containerId, folder);
    const out: SpeFileItem[] = [];
    for (const child of children) {
      if (child.kind === "folder") {
        const sub = await this.recurseFiles(
          containerId,
          joinPath(folder, child.name),
        );
        out.push(...sub);
      } else {
        out.push(child);
      }
    }
    return out;
  }

  async getMetadata(itemId: string, containerIdOverride?: string): Promise<SpeFileItem> {
    const containerId = containerIdOverride ?? (await this.resolveContainerId());
    return this.getGraph().getItem(containerId, itemId);
  }
}

// Singleton — the MSAL client and drive-id cache should be process-wide.
export const speFileStorage = new SpeFileStorage();

// Characters forbidden in SharePoint / SPE file paths:
// " * : < > ? \ | and also # % (ambiguous after URL encoding) and / (path sep)
// Wix-imported filenames commonly start with "wix:image://..." — the colon
// is the most frequent offender; strip everything non-safe in one pass.
const GRAPH_FORBIDDEN_RE = /[*":<>?/\\|#%]+/g;

function buildPath(
  documentType: SpeDocumentType,
  ownerId: string,
  filename: string,
): string {
  const prefix = ownerId.slice(0, 2) || "00";
  const safeName =
    filename
      .replace(GRAPH_FORBIDDEN_RE, "_")
      .replace(/_+/g, "_") // collapse consecutive underscores
      .replace(/^_|_$/g, "") // trim leading/trailing underscores
      .trim() || "unnamed";
  return `/${documentType}/${prefix}/${ownerId}-${safeName}`;
}

function joinPath(base: string, segment: string): string {
  const left = base.endsWith("/") ? base.slice(0, -1) : base;
  const right = segment.startsWith("/") ? segment.slice(1) : segment;
  return `${left || ""}/${right}`;
}

function buildMetadataFields(opts: StoreFileOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out["SynozurDocumentType"] = opts.documentType;
  out["SynozurOwnerId"] = opts.ownerId;
  out["SynozurOriginalFileName"] = opts.filename;
  out["SynozurContentType"] = opts.contentType;
  if (opts.uploadedByUserId) out["SynozurUploadedByUserId"] = opts.uploadedByUserId;
  if (opts.extraFields) Object.assign(out, opts.extraFields);
  return out;
}
