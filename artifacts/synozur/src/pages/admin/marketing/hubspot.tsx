import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

// #131: HubSpot integration admin surface. Read-only health view + a small
// settings form. Per-form-type toggles and lifecycle mappings are stored as
// JSON in site_settings; we render them as labeled rows.

interface SyncEvent {
  id: string;
  kind: string;
  contactEmail: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  hubspotResourceId: string | null;
  nextAttemptAt: string;
  createdAt: string;
  succeededAt: string | null;
  // New: link back to the originating submission so admins can force a
  // full re-sync (contact upsert + matching timeline event).
  submissionId?: number | null;
}

interface HubspotStatus {
  configured: boolean;

  enabled: boolean;

  portalId: string | null;

  timelineAppId: string | null;

  formToggles: Record<string, boolean> | null;

  lifecycleMappings: Record<string, string> | null;

  euOptInDefault: boolean;

  queue: {
    pending: number;
    deadLetter: number;
    succeeded: number;
    companies?: { pending: number; deadLetter: number };
    deals?: { pending: number; deadLetter: number };
  };

  skippedTimelineCount: number;
  // #131 — health surface. `connection` is a live probe of the HubSpot
  // account-info endpoint, `freshness` is the most-recent successful
  // sync per kind/form-type so we can flag stale or never-synced flows.

  connection?: {
    ok: boolean;
    portalId?: number | null;
    error?: string | null;

  } | null;

  freshness?: {
    lastContactUpsert: string | null;
    lastTimelineEvent: string | null;
    lastDeadLetter?: string | null;
    perFormType: Record<string, string | null>;
  } | null;

  recentEvents: Array<SyncEvent>;

  // #549 — tracking pixel + Forms API stitching config health.
  trackingConfig?: {
    portalIdConfigured: boolean;
    trackingScriptReady: boolean;
    formGuids: Record<string, boolean>;
    setupNote: string;
  };
}

const FORM_TYPES = [
  "contact",
  "subscribe",
  "start",
  "white-paper",
  "webinar",
  "partner",
  "demo",
] as const;
const DEFAULT_LIFECYCLES: Record<string, string> = {
  contact: "lead",
  subscribe: "subscriber",
  start: "marketingqualifiedlead",
  "white-paper": "lead",
  webinar: "lead",
  partner: "lead",
  demo: "marketingqualifiedlead",
};

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "never";
  const delta = Math.max(0, Date.now() - ts);
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
      } catch { /* ignore */ }
      throw new Error(`${r.status} ${detail}`);
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  });
}

export default function HubspotAdminPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<HubspotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erasureEmail, setErasureEmail] = useState("");
  const [timelineAppIdDraft, setTimelineAppIdDraft] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiFetch<HubspotStatus>("/admin/integrations/hubspot/status");
      setStatus(data);
    } catch (e) {
      toast({ title: "Load failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  // Keep the controlled timeline-app-id input in sync with whatever the
  // server reports. Without this the field would freeze on its first read
  // and ignore later refreshes (e.g. after a save round-trip).
  useEffect(() => {
    if (status) setTimelineAppIdDraft(status.timelineAppId ?? "");
  }, [status?.timelineAppId]);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      await apiFetch("/admin/integrations/hubspot/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast({ title: "Settings saved" });
      await refresh();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function drainNow() {
    try {
      const r = await apiFetch<{ processed: number }>("/admin/integrations/hubspot/drain", { method: "POST" });
      toast({ title: "Drain complete", description: `Processed ${r.processed} events` });
      await refresh();
    } catch (e) {
      toast({ title: "Drain failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function replay(id: string) {
    try {
      await apiFetch(`/admin/integrations/hubspot/replay/${id}`, { method: "POST" });
      toast({ title: "Re-queued", description: "The event will retry on the next worker tick." });
      await refresh();
    } catch (e) {
      toast({ title: "Replay failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function resyncSubmission(submissionId: number) {
    try {
      await apiFetch(`/admin/integrations/hubspot/resync/${submissionId}`, { method: "POST" });
      toast({
        title: "Re-sync queued",
        description: "Contact upsert and the matching timeline event have been re-enqueued.",
      });
      await refresh();
    } catch (e) {
      toast({ title: "Re-sync failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function retrySkipped() {
    try {
      const r = await apiFetch<{ reset: number }>("/admin/integrations/hubspot/retry-skipped", { method: "POST" });
      toast({
        title: "Skipped events re-queued",
        description: `${r.reset} timeline event${r.reset === 1 ? "" : "s"} reset to pending.`,
      });
      await refresh();
    } catch (e) {
      toast({ title: "Retry failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function erase() {
    if (!erasureEmail.trim()) return;
    if (!confirm(`Permanently delete the HubSpot contact for ${erasureEmail}? This cannot be undone.`)) return;
    try {
      await apiFetch("/admin/integrations/hubspot/erasure", {
        method: "POST",
        body: JSON.stringify({ email: erasureEmail.trim() }),
      });
      toast({ title: "Erasure requested" });
      setErasureEmail("");
    } catch (e) {
      toast({ title: "Erasure failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <AdminLayout
      title="HubSpot integration"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "HubSpot" }]}
    >
      {loading || !status ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <>
          {status.skippedTimelineCount > 0 && !status.timelineAppId && (
            <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold">
                    {status.skippedTimelineCount} timeline event{status.skippedTimelineCount === 1 ? "" : "s"} skipped — HubSpot App ID not set
                  </p>
                  <p>
                    Timeline events (the richest behavioural signal sent to HubSpot) are being silently dropped
                    because the <strong>Timeline app id</strong> is not configured. To find your App ID: open the
                    HubSpot developer portal → <em>App Marketplace</em> → your app → the <em>App ID</em> shown at
                    the top of the page.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href="#hs-app-id-section"
                      className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      Set App ID ↓
                    </a>
                    <Button size="sm" variant="outline" onClick={retrySkipped} disabled={saving}>
                      Retry skipped events after setting the ID
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Card className="p-6 mb-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-lg font-semibold">Connection</div>
                <div className="text-sm text-muted-foreground space-x-2">
                  <span>Token: {status.configured ? <Badge>configured</Badge> : <Badge variant="destructive">missing</Badge>}</span>
                  <span>
                    Live:{" "}
                    {status.connection
                      ? status.connection.ok
                        ? <Badge>reachable</Badge>
                        : <Badge variant="destructive">{status.connection.error ?? "unreachable"}</Badge>
                      : <Badge variant="secondary">unknown</Badge>}
                  </span>
                  <span>Portal: {status.connection?.portalId ?? status.portalId ?? "—"}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="hs-enabled">Enabled</Label>
                <Switch
                  id="hs-enabled"
                  checked={status.enabled}
                  disabled={saving || !status.configured}
                  onCheckedChange={(v) => save({ enabled: v })}
                />
              </div>
            </div>

            <div id="hs-app-id-section">
              <Label htmlFor="hs-app-id">Timeline app id</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="hs-app-id"
                  value={timelineAppIdDraft}
                  onChange={(e) => setTimelineAppIdDraft(e.target.value)}
                  placeholder="HubSpot Public App id (numeric)"
                  onBlur={() => {
                    const v = timelineAppIdDraft.trim();
                    if (v !== (status.timelineAppId ?? "")) save({ timelineAppId: v || null });
                  }}
                />
                {timelineAppIdDraft.trim() ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-label="App ID configured" />
                ) : status.skippedTimelineCount > 0 ? (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-label="Skipped events exist" />
                ) : null}
              </div>
              {!timelineAppIdDraft.trim() && status.skippedTimelineCount > 0 && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {status.skippedTimelineCount} skipped event{status.skippedTimelineCount === 1 ? "" : "s"} waiting for this ID
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Required for timeline events. Without it, contact upserts still
                run; timeline events are marked <code>skipped</code>.
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Switch
                  id="hs-eu-default"
                  checked={status.euOptInDefault}
                  disabled={saving}
                  onCheckedChange={(v) => save({ euOptInDefault: v })}
                />
                <Label htmlFor="hs-eu-default">Global opt-out backstop</Label>
              </div>
              <p className="text-xs text-muted-foreground ml-[52px]">
                EU visitors are automatically defaulted to opt-out via per-request
                geo-IP detection — this toggle is not needed for GDPR compliance.
                It applies only to visitors whose country is explicitly resolved as
                non-EU; enable it to default those visitors to opt-out (e.g. for
                full-globe opt-out campaigns or testing). When the country cannot
                be determined, visitors are tracked (opt-in) by default.
              </p>
            </div>
          </Card>

          {/* #549 — Tracking pixel + Forms API stitching config health */}
          <Card className="p-6 mb-6 space-y-4">
            <div className="text-lg font-semibold">Tracking &amp; stitching</div>
            <p className="text-sm text-muted-foreground">
              The HubSpot tracking pixel sets the <code>hubspotutk</code> cookie and
              records page views. The Forms API stitches that anonymous history to a
              contact when a form is submitted.
            </p>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Tracking script:</span>
              {status.trackingConfig?.trackingScriptReady
                ? <Badge>ready — portal ID configured</Badge>
                : <Badge variant="destructive">not configured — set HUBSPOT_PORTAL_ID</Badge>}
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                Per-form stitching GUIDs
                <span className="ml-1 text-xs">(set <code>HUBSPOT_FORM_GUID_&lt;FORM_TYPE&gt;</code> for each)</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(status.trackingConfig?.formGuids ?? {}).map(([ft, configured]) => (
                  <div key={ft} className="flex items-center justify-between border-b border-border py-1">
                    <code>{ft}</code>
                    {configured
                      ? <Badge variant="default" className="text-xs">configured</Badge>
                      : <Badge variant="secondary" className="text-xs">missing</Badge>}
                  </div>
                ))}
              </div>
            </div>
            {!status.trackingConfig?.trackingScriptReady && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3 leading-relaxed">
                <strong>Setup:</strong> {status.trackingConfig?.setupNote}
              </p>
            )}
          </Card>

          <Card className="p-6 mb-6 space-y-3">
            <div className="text-lg font-semibold">Sync freshness</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Last contact upsert</div>
                <div className="font-medium">{formatRelative(status.freshness?.lastContactUpsert)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Last timeline event</div>
                <div className="font-medium">{formatRelative(status.freshness?.lastTimelineEvent)}</div>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-sm mb-1">Per-form last successful sync</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {FORM_TYPES.map((ft) => (
                  <div key={ft} className="flex items-center justify-between border-b border-border py-1">
                    <code>{ft}</code>
                    <span className="text-muted-foreground">
                      {formatRelative(status.freshness?.perFormType?.[ft] ?? null)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-6 mb-6 space-y-4">
            <div className="text-lg font-semibold">Per-form sync toggles</div>
            <div className="space-y-2">
              {FORM_TYPES.map((ft) => {
                const enabled = status.formToggles?.[ft] !== false;
                return (
                  <div key={ft} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium capitalize">{ft}</div>
                      <div className="text-xs text-muted-foreground">
                        Lifecycle: <code>{status.lifecycleMappings?.[ft] ?? DEFAULT_LIFECYCLES[ft]}</code>
                      </div>
                    </div>
                    <Switch
                      checked={enabled}
                      disabled={saving}
                      onCheckedChange={(v) => save({
                        formToggles: { ...(status.formToggles ?? {}), [ft]: v },
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-6 mb-6">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
              <div>
                <div className="text-lg font-semibold">Sync queue</div>
                <div className="text-sm text-muted-foreground">
                  Pending: {status.queue.pending} · Succeeded: {status.queue.succeeded} · Dead-letter: {status.queue.deadLetter}
                  {status.skippedTimelineCount > 0 && (
                    <span className="ml-1 text-amber-600 font-medium">
                      · Skipped (timeline): {status.skippedTimelineCount}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 space-x-4">
                  <span>
                    Companies — pending: {status.queue.companies?.pending ?? 0} · dead-letter: {status.queue.companies?.deadLetter ?? 0}
                  </span>
                  <span>
                    Deals — pending: {status.queue.deals?.pending ?? 0} · dead-letter: {status.queue.deals?.deadLetter ?? 0}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {status.skippedTimelineCount > 0 && (
                  <Button variant="outline" onClick={retrySkipped} disabled={saving}>
                    Retry {status.skippedTimelineCount} skipped
                  </Button>
                )}
                <Button onClick={drainNow} disabled={saving}>Drain now</Button>
              </div>
            </div>
            <div className="space-y-1">
              {status.recentEvents.slice(0, 10).map((e) => (
                <div key={e.id} className="text-xs flex items-center gap-3 border-t border-border py-1.5">
                  <Badge variant={
                    e.status === "succeeded" ? "default"
                    : e.status === "dead_letter" ? "destructive"
                    : "secondary"
                  }>
                    {e.status}
                  </Badge>
                  <code className="truncate flex-1">{e.kind}</code>
                  <span className="truncate min-w-0 max-w-[200px]">{e.contactEmail ?? "—"}</span>
                  <span className="text-muted-foreground">attempts {e.attempts}</span>
                  {e.lastError && (
                    <span className="text-destructive truncate min-w-0 max-w-[260px]" title={e.lastError}>
                      {e.lastError}
                    </span>
                  )}
                  {e.status === "dead_letter" && (
                    <Button size="sm" variant="ghost" onClick={() => replay(e.id)}>Replay</Button>
                  )}
                  {e.submissionId ? (
                    <Button size="sm" variant="ghost" onClick={() => resyncSubmission(e.submissionId!)}>
                      Re-sync
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-lg font-semibold mb-2">GDPR erasure</div>
            <p className="text-sm text-muted-foreground mb-3">
              Permanently deletes the HubSpot contact and prevents re-creation.
              Use only in response to an authenticated erasure request.
            </p>
            <div className="flex gap-2">
              <Input
                value={erasureEmail}
                onChange={(e) => setErasureEmail(e.target.value)}
                placeholder="user@example.com"
              />
              <Button variant="destructive" onClick={erase} disabled={!erasureEmail.trim()}>
                Erase contact
              </Button>
            </div>
          </Card>
        </>
      )}
    </AdminLayout>
  );
}
