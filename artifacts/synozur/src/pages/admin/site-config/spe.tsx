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
  /** Credentials configured AND a container ID recorded for this slot. */
  speReady: boolean;
  containerTypeId: string | null;
  containerIdDev: string | null;
  containerIdProd: string | null;
  /** Per-slot backend choice stored in DB. */
  storageBackendDev: "gcs" | "spe";
  storageBackendProd: "gcs" | "spe";
  /** Resolved backend for the current environment slot. */
  activeBackend: "gcs" | "spe";
  // Server-derived from NODE_ENV — tells the page which container slot
  // is the one this environment will actually use. Authoritative,
  // because the React build has no `process.env` to consult.
  activeContainerSlot: "dev" | "prod";
}

interface MigrationStatus {
  totalMedia: number;
  migratedToSpe: number;
  awaitingMigration: number;
  failedMigration: number;
}

interface MigrationFailure {
  id: string;
  altText: string;
  storageKey: string;
  speMigrateError: string | null;
}

interface MigrationJob {
  status: "idle" | "running" | "completed" | "failed";
  dryRun: boolean;
  limit: number | null;
  startedAt: number | null;
  completedAt: number | null;
  processed: number;
  succeeded: number;
  failed: number;
  failures: Array<{ id: string; reason: string }>;
  error: string | null;
}

interface RoundTripResult {
  ok: boolean;
  containerId: string;
  itemId: string;
  uploadedSize: number;
  readbackSize: number;
  bytesMatch: boolean;
  timings: { upload: number; readback: number; delete: number };
}

interface OrphanItem {
  id: string;
  name: string;
  size: number;
  contentType: string;
  ageHours: number | null;
}

interface OrphanScanResult {
  containerId: string;
  totalInContainer: number;
  knownInDb: number;
  orphanCount: number;
  orphanBytes: number;
  skippedByAge: number;
  sample: OrphanItem[];
  sampleCapped: boolean;
}

interface CleanupResult {
  containerId: string;
  attempted: number;
  deleted: number;
  skipped: number;
  failures: Array<{ id: string; reason: string }>;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
  const [migrationJob, setMigrationJob] = useState<MigrationJob | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [containerTypeDraft, setContainerTypeDraft] = useState("");
  const [roundTrip, setRoundTrip] = useState<RoundTripResult | null>(null);
  const [roundTripBusy, setRoundTripBusy] = useState(false);
  const [orphans, setOrphans] = useState<OrphanScanResult | null>(null);
  const [orphansBusy, setOrphansBusy] = useState(false);
  const [provisionColumnsBusy, setProvisionColumnsBusy] = useState(false);
  const [provisionColumnsResult, setProvisionColumnsResult] = useState<{
    created: string[];
    existed: string[];
  } | null>(null);
  const [failures, setFailures] = useState<MigrationFailure[] | null>(null);
  const [failuresBusy, setFailuresBusy] = useState(false);
  const [clearErrorsBusy, setClearErrorsBusy] = useState(false);
  const [devResetOpts, setDevResetOpts] = useState({
    resetMigration: true,
    clearContainerDev: false,
    clearContainerProd: false,
  });
  const [devResetConfirm, setDevResetConfirm] = useState(false);
  const [devResetBusy, setDevResetBusy] = useState(false);
  const [devResetResult, setDevResetResult] = useState<{
    affectedMediaRows?: number;
    cleared: string[];
  } | null>(null);

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

  // Poll migration counts every 10s.
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

  // Poll job state every 3s while a migration is running.
  useEffect(() => {
    if (!status?.credentialsConfigured) return;
    const tick = setInterval(() => {
      apiFetch<MigrationJob>("/admin/integrations/spe/migration/job")
        .then((job) => {
          setMigrationJob(job);
          // Refresh the counts table whenever the job finishes.
          if (job.status === "completed" || job.status === "failed") {
            apiFetch<MigrationStatus>("/admin/integrations/spe/migration-status")
              .then(setMigration)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 3_000);
    return () => clearInterval(tick);
  }, [status?.credentialsConfigured]);

  async function runMigrationJob(opts: { dryRun: boolean; limit: number | null }) {
    if (migrationBusy) return;
    if (
      !opts.dryRun &&
      opts.limit === null &&
      !confirm(
        "Run the full GCS → SPE migration? This will upload all unmigrated media files to SharePoint Embedded. GCS files are never deleted.",
      )
    )
      return;
    setMigrationBusy(true);
    try {
      const job = await apiFetch<{ ok: boolean; job: MigrationJob }>(
        "/admin/integrations/spe/migration/run",
        {
          method: "POST",
          body: JSON.stringify(opts),
        },
      );
      setMigrationJob(job.job);
      toast({
        title: opts.dryRun
          ? "Dry run started"
          : opts.limit
            ? `Smoke test started (${opts.limit} rows)`
            : "Full migration started",
        description: "Progress updates every 3 seconds.",
      });
    } catch (e) {
      toast({
        title: "Failed to start migration",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setMigrationBusy(false);
    }
  }

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

  async function runTestUpload() {
    setRoundTripBusy(true);
    setRoundTrip(null);
    try {
      const r = await apiFetch<RoundTripResult>(
        "/admin/integrations/spe/test-upload",
        { method: "POST", body: JSON.stringify({}) },
      );
      setRoundTrip(r);
      toast({
        title: r.ok ? "Round-trip succeeded" : "Round-trip incomplete",
        description: r.ok
          ? `${r.uploadedSize} bytes ↔ ${r.readbackSize} bytes; bytes ${r.bytesMatch ? "match" : "differ"}`
          : "Some phase failed — see card below",
        variant: r.ok ? "default" : "destructive",
      });
    } catch (e) {
      toast({
        title: "Test upload failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setRoundTripBusy(false);
    }
  }

  async function scanOrphans() {
    setOrphansBusy(true);
    try {
      const r = await apiFetch<OrphanScanResult>(
        "/admin/integrations/spe/orphans",
      );
      setOrphans(r);
      toast({
        title: "Orphan scan complete",
        description: `${r.orphanCount} orphans · ${fmtBytes(r.orphanBytes)}`,
      });
    } catch (e) {
      toast({
        title: "Orphan scan failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setOrphansBusy(false);
    }
  }

  async function cleanupOrphans(dryRun: boolean) {
    if (!dryRun && !confirm("Permanently delete the listed orphan files from the SPE container?")) {
      return;
    }
    setOrphansBusy(true);
    try {
      const r = await apiFetch<CleanupResult>(
        "/admin/integrations/spe/orphans/cleanup",
        {
          method: "POST",
          body: JSON.stringify({
            dryRun,
            itemIds: orphans?.sample.map((o) => o.id),
          }),
        },
      );
      toast({
        title: dryRun ? "Dry-run complete" : "Cleanup complete",
        description: `${r.deleted} ${dryRun ? "would be deleted" : "deleted"}, ${r.failures.length} failed`,
        variant: r.failures.length > 0 ? "destructive" : "default",
      });
      // Re-scan to refresh counts after a real delete.
      if (!dryRun) await scanOrphans();
    } catch (e) {
      toast({
        title: "Cleanup failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setOrphansBusy(false);
    }
  }

  async function createContainer(
    slot: "dev" | "prod",
    displayName: string,
    description: string,
  ) {
    try {
      const r = await apiFetch<{
        containerId: string;
        columns: { created: string[]; existed: string[] } | null;
      }>(
        "/admin/integrations/spe/container",
        {
          method: "POST",
          body: JSON.stringify({ slot, displayName, description: description || undefined }),
        },
      );
      const colsSummary = r.columns
        ? ` · ${r.columns.created.length} columns provisioned`
        : " · column provisioning failed (run manually)";
      toast({
        title: `${slot} container created`,
        description: r.containerId + colsSummary,
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

  async function devReset() {
    setDevResetBusy(true);
    setDevResetResult(null);
    try {
      const r = await apiFetch<{ ok: boolean; affectedMediaRows?: number; cleared: string[] }>(
        "/admin/integrations/spe/dev-reset",
        { method: "POST", body: JSON.stringify(devResetOpts) },
      );
      setDevResetResult(r);
      setDevResetConfirm(false);
      // Refresh status so the container ID cards update.
      await refresh();
      toast({
        title: "Dev reset complete",
        description: [
          devResetOpts.resetMigration
            ? `${r.affectedMediaRows ?? 0} media rows cleared`
            : null,
          r.cleared.length > 0 ? `Container IDs cleared: ${r.cleared.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    } catch (e) {
      toast({
        title: "Dev reset failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setDevResetBusy(false);
    }
  }

  async function provisionColumns(slot?: "dev" | "prod") {
    setProvisionColumnsBusy(true);
    try {
      const r = await apiFetch<{
        ok: boolean;
        slot: string;
        containerId: string;
        created: string[];
        existed: string[];
      }>("/admin/integrations/spe/provision-columns", {
        method: "POST",
        body: JSON.stringify(slot ? { slot } : {}),
      });
      setProvisionColumnsResult(r);
      toast({
        title: "Columns provisioned",
        description:
          r.created.length > 0
            ? `${r.created.length} created, ${r.existed.length} already existed.`
            : `All ${r.existed.length} columns already in place.`,
      });
    } catch (e) {
      toast({
        title: "Column provisioning failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setProvisionColumnsBusy(false);
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
            <div className="text-lg font-semibold">Connection</div>

            {/* Prerequisites */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <span className={status.credentialsConfigured ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                  {status.credentialsConfigured ? "✓" : "✗"}
                </span>
                <span>Entra credentials</span>
                {status.tenantId && (
                  <code className="text-xs text-muted-foreground ml-1">{status.tenantId}</code>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={status.containerIdDev ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                  {status.containerIdDev ? "✓" : "✗"}
                </span>
                <span>Container (dev)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={status.containerIdProd ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                  {status.containerIdProd ? "✓" : "✗"}
                </span>
                <span>Container (prod)</span>
              </div>
            </div>

            {!status.credentialsConfigured && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Set <code>ENTRA_TENANT_ID</code>, <code>ENTRA_APP_CLIENT_ID</code>, and{" "}
                <code>ENTRA_APP_CLIENT_SECRET</code> as environment secrets, then redeploy.
              </p>
            )}

            {/* Per-environment backend selector — stored in DB, no deploy needed */}
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Each environment's active backend is stored in the database. Switching takes
                effect within 30 seconds — no redeploy required. Only switch an environment
                to SPE once its container is created and the migration is complete.
              </p>
              {(["dev", "prod"] as const).map((slot) => {
                const backendKey =
                  slot === "dev" ? "storageBackendDev" : "storageBackendProd";
                const currentBackend = status[backendKey];
                const containerReady = slot === "dev" ? !!status.containerIdDev : !!status.containerIdProd;
                const isActive = status.activeContainerSlot === slot;
                return (
                  <div key={slot} className="flex items-center justify-between gap-4">
                    <div className="text-sm">
                      <span className="font-medium capitalize">{slot}</span>
                      {isActive && (
                        <Badge variant="outline" className="ml-2 text-xs">current env</Badge>
                      )}
                      <span className="ml-2 text-muted-foreground">
                        → <Badge variant={currentBackend === "spe" ? "default" : "secondary"} className="text-xs">
                          {currentBackend.toUpperCase()}
                        </Badge>
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={currentBackend === "gcs" ? "default" : "outline"}
                        disabled={saving || currentBackend === "gcs"}
                        onClick={() => patchSettings({ [backendKey]: "gcs" })}
                      >
                        GCS
                      </Button>
                      <Button
                        size="sm"
                        variant={currentBackend === "spe" ? "default" : "outline"}
                        disabled={saving || currentBackend === "spe" || !containerReady || !status.credentialsConfigured}
                        title={!containerReady ? `Create a ${slot} container first` : undefined}
                        onClick={() => patchSettings({ [backendKey]: "spe" })}
                      >
                        SPE
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
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

            {/* Custom columns — provisioned via the SPE-native
                /storage/fileStorage/containers/{id}/columns endpoint.
                New containers have columns auto-provisioned at create time.
                Use the buttons below to provision (or re-verify) columns on
                existing containers. Idempotent — safe to run multiple times. */}
            <div className="border-t pt-4 space-y-3">
              <div>
                <div className="text-sm font-medium">Custom SharePoint columns</div>
                <p className="text-xs text-muted-foreground">
                  Five <code>Synozur*</code> text columns are provisioned on
                  each container so every uploaded file is stamped with its
                  document type, owner, original filename, content type, and
                  uploader. New containers are provisioned automatically.
                  Use the buttons below to provision existing containers or
                  to confirm columns are in place.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["dev", "prod"] as const).map((slot) => {
                  const hasContainer =
                    slot === "dev" ? !!status.containerIdDev : !!status.containerIdProd;
                  return (
                    <Button
                      key={slot}
                      variant="outline"
                      size="sm"
                      disabled={
                        provisionColumnsBusy ||
                        !status.credentialsConfigured ||
                        !hasContainer
                      }
                      title={!hasContainer ? `Create a ${slot} container first` : undefined}
                      onClick={() => provisionColumns(slot)}
                    >
                      {provisionColumnsBusy ? "Provisioning…" : `Provision columns (${slot})`}
                    </Button>
                  );
                })}
              </div>
              {provisionColumnsResult && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {provisionColumnsResult.created.length > 0 && (
                    <div>
                      <span className="text-green-600 dark:text-green-400 font-medium">Created: </span>
                      {provisionColumnsResult.created.join(", ")}
                    </div>
                  )}
                  {provisionColumnsResult.existed.length > 0 && (
                    <div>
                      <span className="font-medium">Already in place: </span>
                      {provisionColumnsResult.existed.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Round-trip test — validates auth/container/Graph end-to-end. */}
          <Card className="p-6 mb-6 space-y-4">
            <div>
              <div className="text-lg font-semibold">Round-trip test</div>
              <p className="text-sm text-muted-foreground">
                Uploads a synthetic 2 KB file, reads it back to verify
                the bytes match, then deletes it. Use after provisioning
                the container to confirm credentials, container access,
                and Graph wiring before any real data is involved.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={runTestUpload}
                disabled={
                  roundTripBusy ||
                  !status.credentialsConfigured ||
                  !status.containerTypeId ||
                  (status.activeContainerSlot === "prod"
                    ? !status.containerIdProd
                    : !status.containerIdDev)
                }
              >
                {roundTripBusy ? "Running…" : "Run test upload"}
              </Button>
              {roundTrip && (
                <Badge variant={roundTrip.ok ? "default" : "destructive"}>
                  {roundTrip.ok ? "passed" : "failed"}
                </Badge>
              )}
            </div>
            {roundTrip && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>
                  Item id: <code>{roundTrip.itemId}</code>
                </div>
                <div>
                  Bytes: {roundTrip.uploadedSize} ↔ {roundTrip.readbackSize}{" "}
                  · match: {String(roundTrip.bytesMatch)}
                </div>
                <div>
                  Timings: upload {roundTrip.timings.upload} ms · readback{" "}
                  {roundTrip.timings.readback} ms · delete{" "}
                  {roundTrip.timings.delete} ms
                </div>
              </div>
            )}
          </Card>

          {/* Orphan management — needed for delete-recreate testing where
              the DB is wiped but SPE bytes survive. */}
          <Card className="p-6 mb-6 space-y-4">
            <div>
              <div className="text-lg font-semibold">Orphan management</div>
              <p className="text-sm text-muted-foreground">
                Lists drive items in the active SPE container that have no
                matching <code>media.spe_file_id</code>. Items younger
                than 2 hours are skipped to avoid racing in-flight uploads.
                Cleanup defaults to dry-run; explicitly confirm to delete.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={scanOrphans}
                disabled={orphansBusy || !status.credentialsConfigured}
              >
                {orphansBusy ? "Scanning…" : "Scan for orphans"}
              </Button>
              {orphans && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => cleanupOrphans(true)}
                    disabled={orphansBusy || orphans.orphanCount === 0}
                  >
                    Dry-run cleanup
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => cleanupOrphans(false)}
                    disabled={orphansBusy || orphans.orphanCount === 0}
                  >
                    Delete listed
                  </Button>
                </>
              )}
            </div>
            {orphans && (
              <div className="space-y-2 border-t border-border pt-4">
                <div className="text-sm">
                  Container: <code>{orphans.containerId}</code> ·{" "}
                  {orphans.totalInContainer} files in container ·{" "}
                  {orphans.knownInDb} known in DB
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {orphans.orphanCount.toLocaleString()}{" "}
                  <span className="text-sm text-muted-foreground font-normal">
                    orphan{orphans.orphanCount === 1 ? "" : "s"} ·{" "}
                    {fmtBytes(orphans.orphanBytes)}
                  </span>
                </div>
                {orphans.skippedByAge > 0 && (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    {orphans.skippedByAge} unrecognised file
                    {orphans.skippedByAge === 1 ? "" : "s"} skipped — younger
                    than 2 h or no timestamp from Graph. Re-scan after 2 hours
                    to include them.
                  </div>
                )}
                {orphans.sample.length > 0 && (
                  <div className="text-xs space-y-0.5 max-h-64 overflow-y-auto">
                    {orphans.sample.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center gap-2 border-t border-border py-1"
                      >
                        <span className="truncate flex-1">{o.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {fmtBytes(o.size)}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {o.ageHours == null ? "—" : `${o.ageHours}h`}
                        </span>
                      </div>
                    ))}
                    {orphans.sampleCapped && (
                      <p className="text-muted-foreground pt-1">
                        … sample capped at {orphans.sample.length}; cleanup
                        only affects the listed items. Re-scan after each
                        cleanup pass to clear the rest.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Migration status — drives the GCS → SPE cutover. */}
          <Card className="p-6 space-y-4">
            <div>
              <div className="text-lg font-semibold">Migration (GCS → SPE)</div>
              <p className="text-sm text-muted-foreground">
                Additive and resumable — only rows where{" "}
                <code>spe_file_id IS NULL</code> are touched. GCS bytes are
                kept as the rollback safety net; setting{" "}
                <code>spe_file_id = NULL</code> on any row reverts it to GCS
                instantly.
              </p>
            </div>

            {migration ? (
              <div className="grid grid-cols-4 gap-4">
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
                <div>
                  <div
                    className={`text-3xl font-semibold tabular-nums ${
                      migration.failedMigration > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {(migration.failedMigration ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Permanently failed
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Counts unavailable.
              </div>
            )}

            {/* Failed files panel */}
            {migration && migration.failedMigration > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-destructive">
                    {migration.failedMigration} file
                    {migration.failedMigration !== 1 ? "s" : ""} permanently
                    failed — excluded from future runs until cleared
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={failuresBusy}
                      onClick={async () => {
                        setFailuresBusy(true);
                        try {
                          const data = await apiFetch<{
                            failures: MigrationFailure[];
                          }>("/admin/integrations/spe/migration/failures");
                          setFailures(data.failures);
                        } catch {
                          toast({
                            title: "Could not load failure details",
                            variant: "destructive",
                          });
                        } finally {
                          setFailuresBusy(false);
                        }
                      }}
                    >
                      {failuresBusy ? "Loading…" : failures ? "Refresh" : "View details"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={clearErrorsBusy || migrationJob?.status === "running"}
                      onClick={async () => {
                        setClearErrorsBusy(true);
                        try {
                          await apiFetch(
                            "/admin/integrations/spe/migration/clear-errors",
                            { method: "POST", body: JSON.stringify({}) },
                          );
                          setFailures(null);
                          const updated = await apiFetch<MigrationStatus>(
                            "/admin/integrations/spe/migration-status",
                          );
                          setMigration(updated);
                          toast({ title: "Errors cleared — files re-queued for migration" });
                        } catch {
                          toast({
                            title: "Could not clear errors",
                            variant: "destructive",
                          });
                        } finally {
                          setClearErrorsBusy(false);
                        }
                      }}
                    >
                      {clearErrorsBusy ? "Clearing…" : "Clear all & retry"}
                    </Button>
                  </div>
                </div>

                {failures && failures.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left pb-1 pr-3 font-medium text-muted-foreground w-40">
                            Storage key
                          </th>
                          <th className="text-left pb-1 pr-3 font-medium text-muted-foreground w-40">
                            Alt text
                          </th>
                          <th className="text-left pb-1 font-medium text-muted-foreground">
                            Error
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {failures.map((f) => (
                          <tr key={f.id} className="border-b border-border/50">
                            <td className="py-1 pr-3 font-mono text-muted-foreground truncate max-w-[160px]">
                              {f.storageKey}
                            </td>
                            <td className="py-1 pr-3 truncate max-w-[160px]">
                              {f.altText}
                            </td>
                            <td className="py-1 text-destructive break-all">
                              {f.speMigrateError}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Trigger buttons */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-sm font-medium">Run migration</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={migrationBusy || migrationJob?.status === "running"}
                  onClick={() => runMigrationJob({ dryRun: true, limit: null })}
                >
                  Dry run
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={migrationBusy || migrationJob?.status === "running"}
                  onClick={() =>
                    runMigrationJob({ dryRun: false, limit: 10 })
                  }
                >
                  Smoke test (10 rows)
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={
                    migrationBusy ||
                    migrationJob?.status === "running" ||
                    migration?.awaitingMigration === 0
                  }
                  onClick={() => runMigrationJob({ dryRun: false, limit: null })}
                >
                  Full run
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs in the background — you can navigate away. Progress
                updates every 3 s. Restarting the server resets job state but
                does not lose work (re-run picks up where it left off).
              </p>
            </div>

            {/* Live job status */}
            {migrationJob && migrationJob.status !== "idle" && (
              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {migrationJob.status === "running" && (
                    <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                  )}
                  {migrationJob.status === "completed" && (
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  )}
                  {migrationJob.status === "failed" && (
                    <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                  )}
                  {migrationJob.status === "running"
                    ? "Running…"
                    : migrationJob.status === "completed"
                      ? "Completed"
                      : "Failed"}
                  {migrationJob.dryRun && (
                    <Badge variant="secondary" className="text-xs">
                      dry run
                    </Badge>
                  )}
                  {migrationJob.limit !== null && (
                    <Badge variant="secondary" className="text-xs">
                      limit {migrationJob.limit}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="font-semibold tabular-nums">
                      {migrationJob.processed}
                    </span>{" "}
                    <span className="text-muted-foreground text-xs">
                      processed
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold tabular-nums text-green-600">
                      {migrationJob.succeeded}
                    </span>{" "}
                    <span className="text-muted-foreground text-xs">ok</span>
                  </div>
                  <div>
                    <span className="font-semibold tabular-nums text-red-500">
                      {migrationJob.failed}
                    </span>{" "}
                    <span className="text-muted-foreground text-xs">
                      failed
                    </span>
                  </div>
                </div>

                {migrationJob.startedAt && (
                  <div className="text-xs text-muted-foreground">
                    Started{" "}
                    {new Date(migrationJob.startedAt).toLocaleTimeString()}
                    {migrationJob.completedAt &&
                      ` · took ${(
                        (migrationJob.completedAt - migrationJob.startedAt) /
                        1000
                      ).toFixed(1)}s`}
                  </div>
                )}

                {migrationJob.error && (
                  <div className="rounded bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                    {migrationJob.error}
                  </div>
                )}

                {migrationJob.failures.length > 0 && (
                  <div className="text-xs space-y-0.5 max-h-40 overflow-y-auto border-t border-border pt-2">
                    <div className="text-muted-foreground mb-1">
                      Failures ({migrationJob.failures.length}):
                    </div>
                    {migrationJob.failures.map((f) => (
                      <div key={f.id} className="flex gap-2">
                        <code className="shrink-0 text-muted-foreground">
                          {f.id.slice(0, 8)}
                        </code>
                        <span className="text-destructive truncate">
                          {f.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* ----------------------------------------------------------------
              Dev-only danger zone — server returns 403 in production.
              Lets you null out spe_file_id pointers and/or wipe container
              IDs from settings so you can reprovision and re-run clean.
          ---------------------------------------------------------------- */}
          {status.activeContainerSlot === "dev" && (
            <Card className="p-6 mb-6 space-y-4 border-destructive/40">
              <div>
                <div className="text-lg font-semibold text-destructive">
                  Development reset
                </div>
                <p className="text-sm text-muted-foreground">
                  Clears SPE state in the database so you can reprovision
                  containers and re-run the migration from scratch.{" "}
                  <strong>GCS bytes are never touched</strong> — storage keys
                  remain valid and serve as the rollback path.{" "}
                  <strong>SPE files already uploaded become orphans</strong>{" "}
                  — run the orphan cleaner on the container afterward.
                  Not available in production.
                </p>
              </div>

              {/* Option checkboxes */}
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={devResetOpts.resetMigration}
                    onChange={(e) =>
                      setDevResetOpts((o) => ({
                        ...o,
                        resetMigration: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    Clear <code>spe_file_id</code> on all media rows
                    {migration
                      ? ` (${migration.migratedToSpe} rows currently migrated)`
                      : ""}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={devResetOpts.clearContainerDev}
                    disabled={!status.containerIdDev}
                    onChange={(e) =>
                      setDevResetOpts((o) => ({
                        ...o,
                        clearContainerDev: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    Clear dev container ID from settings
                    {status.containerIdDev ? (
                      <code className="ml-1 text-xs text-muted-foreground">
                        {status.containerIdDev.slice(0, 16)}…
                      </code>
                    ) : (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (not set)
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={devResetOpts.clearContainerProd}
                    disabled={!status.containerIdProd}
                    onChange={(e) =>
                      setDevResetOpts((o) => ({
                        ...o,
                        clearContainerProd: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    Clear prod container ID from settings
                    {status.containerIdProd ? (
                      <code className="ml-1 text-xs text-muted-foreground">
                        {status.containerIdProd.slice(0, 16)}…
                      </code>
                    ) : (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (not set)
                      </span>
                    )}
                  </span>
                </label>
              </div>

              {/* Confirm / execute */}
              {!devResetConfirm ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={
                    devResetBusy ||
                    (!devResetOpts.resetMigration &&
                      !devResetOpts.clearContainerDev &&
                      !devResetOpts.clearContainerProd)
                  }
                  onClick={() => setDevResetConfirm(true)}
                >
                  Reset selected…
                </Button>
              ) : (
                <div className="flex items-center gap-3 rounded border border-destructive/50 bg-destructive/5 px-3 py-2">
                  <span className="text-sm text-destructive font-medium flex-1">
                    This cannot be undone. Continue?
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={devResetBusy}
                    onClick={devReset}
                  >
                    {devResetBusy ? "Resetting…" : "Yes, reset"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={devResetBusy}
                    onClick={() => setDevResetConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {devResetResult && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {devResetResult.affectedMediaRows !== undefined && (
                    <div>
                      Media rows cleared:{" "}
                      <strong>{devResetResult.affectedMediaRows}</strong>
                    </div>
                  )}
                  {devResetResult.cleared.length > 0 && (
                    <div>
                      Container IDs removed: {devResetResult.cleared.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </AdminLayout>
  );
}
