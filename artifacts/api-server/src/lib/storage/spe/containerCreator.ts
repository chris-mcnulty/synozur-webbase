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

import { SpeGraphClient, SpeGraphRequestError } from "./graphClient";

export interface CreatedContainer {
  containerId: string;
  displayName: string;
  description?: string;
  status: string;
}

// Custom SharePoint list columns to provision on a new container's document
// library. Graph will reject writes to these fields until they exist on the
// list schema; provisioning is idempotent (409 = already present, skip).
export const SYNOZUR_COLUMNS = [
  { name: "SynozurDocumentType",    displayName: "Synozur Document Type" },
  { name: "SynozurOwnerId",         displayName: "Synozur Owner ID" },
  { name: "SynozurOriginalFileName", displayName: "Synozur Original File Name" },
  { name: "SynozurContentType",     displayName: "Synozur Content Type" },
  { name: "SynozurUploadedByUserId", displayName: "Synozur Uploaded By User ID" },
] as const;

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

  // Provisions the Synozur* custom text columns on an existing container's
  // SharePoint document library so that metadata stamping in storeFile()
  // works. Idempotent: 409 Conflict means the column already exists — fine.
  //
  // Must be called after createContainer() for new containers and can be
  // re-run at any time for containers created before column provisioning
  // was added (i.e. the dev and prod containers already in production).
  async provisionColumns(containerId: string): Promise<ProvisionColumnsResult> {
    const driveId = await this.graph.getContainerDriveId(containerId);
    const created: string[] = [];
    const existed: string[] = [];

    for (const col of SYNOZUR_COLUMNS) {
      try {
        await this.graph.request<void>(
          this.graph.v1Url(`/drives/${driveId}/list/columns`),
          {
            method: "POST",
            body: JSON.stringify({
              name: col.name,
              displayName: col.displayName,
              text: {},
            }),
            headers: { "Content-Type": "application/json" },
            skipJsonParse: true,
          },
        );
        created.push(col.name);
      } catch (err) {
        if (err instanceof SpeGraphRequestError && err.status === 409) {
          existed.push(col.name);
        } else {
          throw err;
        }
      }
    }

    return { created, existed };
  }
}
