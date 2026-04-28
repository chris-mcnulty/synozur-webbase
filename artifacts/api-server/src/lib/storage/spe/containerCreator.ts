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

import { SpeGraphClient } from "./graphClient";

export interface CreatedContainer {
  containerId: string;
  displayName: string;
  description?: string;
  status: string;
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
}
