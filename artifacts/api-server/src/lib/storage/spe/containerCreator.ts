// #127 Phase 2 — container-type registration and container provisioning.
//
// Two operations, both run from the admin API at provisioning time and
// designed to be idempotent so an admin can safely retry:
//
//  • registerContainerType(typeId): tells SPE that the Synozur app has
//    permission to use container type `typeId` inside this tenant. Run
//    once per environment after the container type itself is created in
//    Azure Portal.
//
//  • createContainer({ displayName, description, typeId }): allocates a
//    new container of that type and returns the container id. Callers
//    persist the id onto site_settings (dev or prod slot) so file ops
//    can resolve the active container at request time.
//
// Single-tenant: registers and creates inside Synozur's own Entra
// tenant. The Orbit pattern's per-customer registration loop has no
// equivalent here.

import {
  SpeGraphClient,
  SpeGraphRequestError,
  type SpeColumnDefinition,
} from "./graphClient";

export interface CreatedContainer {
  containerId: string;
  displayName: string;
  description?: string;
  status: string;
}

// Custom columns provisioned on a new container so metadata stamping in
// storeFile() can write to them. Provisioning is idempotent — Graph returns
// 409 nameAlreadyExists when a column is already on the schema, which we
// treat as success.
//
// These are written via the SPE-specific endpoint
// `/storage/fileStorage/containers/{id}/columns`. The drive-scoped sibling
// `/drives/{driveId}/list/columns` returns 403 on SPE container sites — that
// path was the source of #127's earlier "permission boundary" bug.
export const SYNOZUR_COLUMNS: readonly SpeColumnDefinition[] = [
  {
    name: "SynozurDocumentType",
    displayName: "Synozur Document Type",
    columnType: "text",
    indexed: true,
    text: { maxLength: 64 },
  },
  {
    name: "SynozurOwnerId",
    displayName: "Synozur Owner ID",
    columnType: "text",
    indexed: true,
    text: { maxLength: 64 },
  },
  {
    name: "SynozurOriginalFileName",
    displayName: "Synozur Original File Name",
    columnType: "text",
    text: { maxLength: 255 },
  },
  {
    name: "SynozurContentType",
    displayName: "Synozur Content Type",
    columnType: "text",
    text: { maxLength: 128 },
  },
  {
    name: "SynozurUploadedByUserId",
    displayName: "Synozur Uploaded By User ID",
    columnType: "text",
    indexed: true,
    text: { maxLength: 64 },
  },
] as const;

// Derived map of column name → provisioned text maxLength so the metadata
// stamper in fileStorage.ts can truncate before PATCHing rather than relying
// on Graph to reject (and on the per-field fallback to detect the rejection).
// Keeping this derived from SYNOZUR_COLUMNS means there's exactly one source
// of truth for column widths.
export const SYNOZUR_COLUMN_MAX_LENGTHS: Readonly<Record<string, number>> =
  Object.freeze(
    Object.fromEntries(
      SYNOZUR_COLUMNS.filter(
        (c): c is SpeColumnDefinition & { text: { maxLength: number } } =>
          c.columnType === "text" && typeof c.text?.maxLength === "number",
      ).map((c) => [c.name, c.text.maxLength]),
    ),
  );

export interface ProvisionColumnsResult {
  created: string[];
  existed: string[];
}

export class SpeContainerCreator {
  constructor(private readonly graph: SpeGraphClient) {}

  // Idempotent — re-PUTting the same registration just confirms it.
  async registerContainerType(containerTypeId: string): Promise<void> {
    const clientId = process.env["ENTRA_APP_CLIENT_ID"];
    if (!clientId) {
      throw new Error("ENTRA_APP_CLIENT_ID is required to register a container type");
    }
    const url = this.graph.betaUrl(
      `/storage/fileStorage/containerTypeRegistrations/${containerTypeId}`,
    );
    await this.graph.request<void>(url, {
      method: "PUT",
      body: JSON.stringify({
        applicationPermissionGrants: [
          {
            appId: clientId,
            delegatedPermissions: ["full"],
            applicationPermissions: ["full"],
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      skipJsonParse: true,
    });
  }

  async createContainer(opts: {
    displayName: string;
    description?: string;
    containerTypeId: string;
  }): Promise<CreatedContainer> {
    const url = this.graph.v1Url(`/storage/fileStorage/containers`);
    const created = await this.graph.request<{
      id: string;
      displayName: string;
      description?: string;
      status?: string;
    }>(url, {
      method: "POST",
      body: JSON.stringify({
        displayName: opts.displayName,
        description: opts.description ?? "",
        containerTypeId: opts.containerTypeId,
      }),
      headers: { "Content-Type": "application/json" },
    });
    if (!created?.id) {
      throw new Error("createContainer returned no id");
    }
    return {
      containerId: created.id,
      displayName: created.displayName,
      description: created.description,
      status: created.status ?? "active",
    };
  }

  // Provisions the Synozur* custom columns on a container's schema so that
  // metadata stamping in storeFile() works. Idempotent: 409 nameAlreadyExists
  // means the column was already provisioned — treated as success.
  //
  // Must be called after createContainer() for new containers and can be
  // re-run at any time on existing containers (containers created before
  // column provisioning was wired up still need this stamp).
  async provisionColumns(containerId: string): Promise<ProvisionColumnsResult> {
    return this.initializeColumnSchema(containerId, SYNOZUR_COLUMNS);
  }

  // Generic bulk schema initializer. Idempotent — catches 409
  // nameAlreadyExists per column and reports it in `existed`. Any other
  // failure aborts the whole operation (the caller usually wants to know).
  async initializeColumnSchema(
    containerId: string,
    columns: readonly SpeColumnDefinition[],
  ): Promise<ProvisionColumnsResult> {
    const created: string[] = [];
    const existed: string[] = [];
    for (const col of columns) {
      try {
        await this.graph.createContainerColumn(containerId, col);
        created.push(col.name);
      } catch (err) {
        if (
          err instanceof SpeGraphRequestError &&
          (err.status === 409 || err.bodyExcerpt.includes("nameAlreadyExists"))
        ) {
          existed.push(col.name);
          continue;
        }
        throw err;
      }
    }
    return { created, existed };
  }
}
