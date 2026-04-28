import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// #127 Phase 2 — admin surface for SharePoint Embedded provisioning.
// Auth credentials live in env (ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID /
// ENTRA_APP_CLIENT_SECRET); everything else — container type id, dev/prod
// container ids, master enable flag — is admin-tunable and persisted on
// site_settings. The page composes the four /admin/integrations/spe/*
// endpoints into a single provisioning flow.

interface SpeStatus {
  credentialsConfigured: boolean;
  tenantId: string | null;
  enabled: boolean;
  containerTypeId: string | null;
  containerIdDev: string | null;
  containerIdProd: string | null;
  activeBackend: string;
}

interface MigrationStatus {
  totalMedia: number;
  migratedToSpe: number;
  awaitingMigration: number;
}

function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return fetch(`${base}/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  }).then(async (r) => {
    if (!r.ok) {
      let detail = r.statusText;
      try {
        const j = (await r.json()) as { error?: string };
        if (j.error) detail = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(`${r.status} ${detail}`);
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  });
}

function ContainerSlot({
  slot,
  containerId,
  canCreate,
  saving,
  onCreate,
}: {
  slot: "dev" | "prod";
  containerId: string | null;
  canCreate: boolean;
  saving: boolean;
  onCreate: (displayName: string, description: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(
    `Synozur ${slot === "prod" ? "Production" : "Development"} SPE`,
  );
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  if (containerId) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge>provisioned</Badge>
          <code className="text-xs break-all">{containerId}</code>
        </div>
        <p className="text-xs text-muted-foreground">
          Stored on site_settings.spe_container_id_{slot}. Re-creating requires
          clearing the column manually.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={`spe-name-${slot}`}>Display name</Label>
        <Input
          id={`spe-name-${slot}`}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={busy || saving}
        />
      </div>
      <div>
        <Label htmlFor={`spe-desc-${slot}`}>Description (optional)</Label>
        <Input
          id={`spe-desc-${slot}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy || saving}
        />
      </div>
      <Button
        disabled={!canCreate || busy || saving || !displayName.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await onCreate(displayName.trim(), description.trim());
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating…" : `Create ${slot} container`}
      </Button>
      {!canCreate && (
        <p className="text-xs text-muted-foreground">
          Set + register a container type id first.
        </p>
      )}
    </div>
  );
}

export default function SpeAdminPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SpeStatus | null>(null);
  const [migration, setMigration] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [containerTypeDraft, setContainerTypeDraft] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [statusData, migrationData] = await Promise.all([
        apiFetch<SpeStatus>("/admin/integrations/spe/status"),
        apiFetch<MigrationStatus>("/admin/integrations/spe/migration-status").catch(
          () => null,
        ),
      ]);
      setStatus(statusData);
      setMigration(migrationData);
    } catch (e) {
      toast({
        title: "Load failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Poll the migration counts every 10s — cheap query, lets the panel
  // tick during a CLI run without the operator having to reload.
  useEffect(() => {
    if (!status?.credentialsConfigured) return;
    const tick = setInterval(() => {
      apiFetch<MigrationStatus>("/admin/integrations/spe/migration-status")
        .then(setMigration)
        .catch(() => {
          /* keep last value */
        });
    }, 10_000);
    return () => clearInterval(tick);
  }, [status?.credentialsConfigured]);

  useEffect(() => {
    if (status) setContainerTypeDraft(status.containerTypeId ?? "");
  }, [status?.containerTypeId]);

  async function patchSettings(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      await apiFetch("/admin/integrations/spe/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast({ title: "Settings saved" });
      await refresh();
    } catch (e) {
      toast({
        title: "Save failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function registerContainerType() {
    setSaving(true);
    try {
      await apiFetch("/admin/integrations/spe/register-container-type", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({
        title: "Container type registered",
        description: "Synozur app now has permission to create containers of this type in the tenant.",
      });
      await refresh();
    } catch (e) {
      toast({
        title: "Registration failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function createContainer(
    slot: "dev" | "prod",
    displayName: string,
    description: string,
  ) {
    try {
      const r = await apiFetch<{ containerId: string }>(
        "/admin/integrations/spe/container",
        {
          method: "POST",
          body: JSON.stringify({ slot, displayName, description: description || undefined }),
        },
      );
      toast({
        title: `${slot} container created`,
        description: r.containerId,
      });
      await refresh();
    } catch (e) {
      toast({
        title: "Container create failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  return (
    <AdminLayout
      title="SharePoint Embedded"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Site Config" },
        { label: "SharePoint Embedded" },
      ]}
    >
      {loading || !status ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Connection / status */}
          <Card className="p-6 mb-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-lg font-semibold">Connection</div>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <div>
                    Credentials:{" "}
                    {status.credentialsConfigured ? (
                      <Badge>configured</Badge>
                    ) : (
                      <Badge variant="destructive">missing</Badge>
                    )}
                  </div>
                  <div>
                    Tenant: <code>{status.tenantId ?? "—"}</code>
                  </div>
                  <div>
                    Active backend: <code>{status.activeBackend}</code>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="spe-enabled">Enabled</Label>
                <Switch
                  id="spe-enabled"
                  checked={status.enabled}
                  disabled={
                    saving ||
                    !status.credentialsConfigured ||
                    (process.env.NODE_ENV === "production"
                      ? !status.containerIdProd
                      : !status.containerIdDev)
                  }
                  onCheckedChange={(v) =>
                    patchSettings({ speStorageEnabled: v })
                  }
                />
              </div>
            </div>
            {!status.credentialsConfigured && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Set <code>ENTRA_TENANT_ID</code>, <code>ENTRA_APP_CLIENT_ID</code>,
                and <code>ENTRA_APP_CLIENT_SECRET</code> in env, then reload.
              </p>
            )}
            {status.enabled && status.activeBackend !== "spe" && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                <code>speStorageEnabled</code> is on but the active backend is{" "}
                <code>{status.activeBackend}</code>. Set{" "}
                <code>STORAGE_BACKEND=spe</code> in env to switch reads/writes to SPE.
              </p>
            )}
          </Card>

          {/* Container type */}
          <Card className="p-6 mb-6 space-y-4">
            <div>
              <div className="text-lg font-semibold">Container type</div>
              <p className="text-sm text-muted-foreground">
                One-time platform-level setup. Create the container type in
                Azure Portal, paste the GUID below, then click "Register" so
                this app has permission to allocate containers of that type
                inside the Synozur tenant.
              </p>
            </div>
            <div>
              <Label htmlFor="spe-type-id">Container type id</Label>
              <div className="flex gap-2">
                <Input
                  id="spe-type-id"
                  value={containerTypeDraft}
                  onChange={(e) => setContainerTypeDraft(e.target.value)}
                  placeholder="container-type GUID"
                  disabled={saving}
                />
                <Button
                  disabled={
                    saving ||
                    !containerTypeDraft.trim() ||
                    containerTypeDraft.trim() === (status.containerTypeId ?? "")
                  }
                  onClick={() =>
                    patchSettings({
                      speContainerTypeId: containerTypeDraft.trim(),
                    })
                  }
                >
                  Save
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={
                  saving ||
                  !status.credentialsConfigured ||
                  !status.containerTypeId
                }
                onClick={registerContainerType}
              >
                Register in tenant
              </Button>
              <p className="text-xs text-muted-foreground">
                Idempotent — safe to re-run if you rotated the app secret.
              </p>
            </div>
          </Card>

          {/* Containers (dev + prod) */}
          <Card className="p-6 mb-6 space-y-4">
            <div>
              <div className="text-lg font-semibold">Containers</div>
              <p className="text-sm text-muted-foreground">
                One container per environment. The active container is picked
                at request time by <code>NODE_ENV</code>.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-medium mb-2">Development</div>
                <ContainerSlot
                  slot="dev"
                  containerId={status.containerIdDev}
                  canCreate={
                    status.credentialsConfigured && !!status.containerTypeId
                  }
                  saving={saving}
                  onCreate={(name, desc) => createContainer("dev", name, desc)}
                />
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Production</div>
                <ContainerSlot
                  slot="prod"
                  containerId={status.containerIdProd}
                  canCreate={
                    status.credentialsConfigured && !!status.containerTypeId
                  }
                  saving={saving}
                  onCreate={(name, desc) => createContainer("prod", name, desc)}
                />
              </div>
            </div>
          </Card>

          {/* Migration status — drives the GCS → SPE cutover. */}
          <Card className="p-6 space-y-4">
            <div>
              <div className="text-lg font-semibold">Migration (GCS → SPE)</div>
              <p className="text-sm text-muted-foreground">
                Migration is run from the CLI, not this page. Counts below
                refresh every 10s during a run. The GCS bytes are kept as
                the rollback safety net — clearing
                <code className="mx-1">media.spe_file_id</code>
                reverts a row back to GCS without touching either backend.
              </p>
            </div>

            {migration ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {migration.totalMedia.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Total media rows
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {migration.migratedToSpe.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Migrated to SPE
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {migration.awaitingMigration.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Awaiting migration
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Counts unavailable.
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-2">
              <div className="text-sm font-medium">Run the migration</div>
              <pre className="rounded bg-muted px-3 py-2 text-xs overflow-x-auto">
                {`# Dry-run first (no SPE or DB writes):
pnpm --filter @workspace/api-server migrate:gcs-to-spe -- --dry-run

# Migrate 10 rows as a smoke test:
pnpm --filter @workspace/api-server migrate:gcs-to-spe -- --limit 10

# Full run (resumable — re-running picks up where it left off):
pnpm --filter @workspace/api-server migrate:gcs-to-spe`}
              </pre>
              <p className="text-xs text-muted-foreground">
                The script is idempotent and additive: it only touches rows
                where <code>spe_file_id IS NULL</code>, never deletes from
                GCS, and never rewrites <code>storage_key</code>. Crash mid-run
                is safe — re-invoke and it picks up.
              </p>
            </div>
          </Card>
        </>
      )}
    </AdminLayout>
  );
}
