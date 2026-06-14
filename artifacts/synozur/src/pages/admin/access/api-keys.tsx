import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Check, Plus, ShieldOff, Eye, EyeOff, Key } from "lucide-react";

// API Keys admin page — machine-to-machine access management.

interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  prefix: string;
  grantedCapabilities: string[];
  createdByUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
  isRevoked: boolean;
  isExpired: boolean;
}

interface CreateResponse extends ApiKey {
  plaintext: string;
}

const ALL_CAPABILITIES = [
  "content.view",
  "content.author",
  "content.publish",
  "content.moderate",
  "users.manage",
  "site.manage",
  "oauth.manage",
  "api_keys.manage",
  "ai.grounding.manage",
  "client_orgs.manage",
] as const;

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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function PlaintextDisplay({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex items-center gap-2 mt-2 p-3 bg-muted rounded-md font-mono text-sm break-all">
      <span className="flex-1">{visible ? secret : "•".repeat(Math.min(secret.length, 44))}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <CopyButton value={secret} />
    </div>
  );
}

interface CreateFormState {
  name: string;
  description: string;
  grantedCapabilities: string[];
  expiresAt: string;
}

function defaultCreateForm(): CreateFormState {
  return {
    name: "",
    description: "",
    grantedCapabilities: [],
    expiresAt: "",
  };
}

function CreateForm({
  state,
  onChange,
}: {
  state: CreateFormState;
  onChange: (s: CreateFormState) => void;
}) {
  function toggleCap(cap: string) {
    const arr = state.grantedCapabilities;
    const next = arr.includes(cap) ? arr.filter((x) => x !== cap) : [...arr, cap];
    onChange({ ...state, grantedCapabilities: next });
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <Label htmlFor="ak-name">Name *</Label>
        <Input
          id="ak-name"
          value={state.name}
          onChange={(e) => onChange({ ...state, name: e.target.value })}
          placeholder="Orbit Sync"
          className="mt-1"
        />
      </div>

      <div>
        <Label htmlFor="ak-desc">Description</Label>
        <Textarea
          id="ak-desc"
          value={state.description}
          onChange={(e) => onChange({ ...state, description: e.target.value })}
          placeholder="What uses this key and why?"
          rows={2}
          className="mt-1 resize-none"
        />
      </div>

      <div>
        <Label>Granted Capabilities</Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          The key can only use endpoints that require one of these capabilities.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_CAPABILITIES.map((cap) => (
            <label key={cap} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={state.grantedCapabilities.includes(cap)}
                onCheckedChange={() => toggleCap(cap)}
              />
              <span className="text-xs font-mono">{cap}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="ak-expires">Expires At (optional)</Label>
        <Input
          id="ak-expires"
          type="datetime-local"
          value={state.expiresAt}
          onChange={(e) => onChange({ ...state, expiresAt: e.target.value })}
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">Leave blank for a non-expiring key.</p>
      </div>
    </div>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ApiKeysPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(defaultCreateForm());
  const [creating, setCreating] = useState(false);

  const [newKey, setNewKey] = useState<{ name: string; plaintext: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<ApiKey[]>("/cms/api-keys");
      setKeys(data);
    } catch (err) {
      toast({ title: "Failed to load API keys", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    if (!createForm.name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: createForm.name.trim(),
        grantedCapabilities: createForm.grantedCapabilities,
      };
      if (createForm.description.trim()) body.description = createForm.description.trim();
      if (createForm.expiresAt) body.expiresAt = new Date(createForm.expiresAt).toISOString();

      const res = await apiFetch<CreateResponse>("/cms/api-keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setKeys((prev) => [...prev, res].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateOpen(false);
      setCreateForm(defaultCreateForm());
      setNewKey({ name: res.name, plaintext: res.plaintext });
    } catch (err) {
      toast({ title: "Failed to create key", description: String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await apiFetch(`/cms/api-keys/${revokeTarget.id}`, { method: "DELETE" });
      setKeys((prev) =>
        prev.map((k) =>
          k.id === revokeTarget.id ? { ...k, revokedAt: new Date().toISOString(), isRevoked: true } : k,
        ),
      );
      setRevokeTarget(null);
      toast({ title: "Key revoked", description: `"${revokeTarget.name}" can no longer authenticate.` });
    } catch (err) {
      toast({ title: "Failed to revoke key", description: String(err), variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  const active = keys.filter((k) => !k.isRevoked && !k.isExpired);
  const inactive = keys.filter((k) => k.isRevoked || k.isExpired);

  function KeyCard({ k }: { k: ApiKey }) {
    return (
      <Card key={k.id} className={`p-5 ${k.isRevoked || k.isExpired ? "opacity-60" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold">{k.name}</span>
              {k.isRevoked && <Badge variant="destructive">Revoked</Badge>}
              {!k.isRevoked && k.isExpired && <Badge variant="outline">Expired</Badge>}
            </div>
            {k.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{k.description}</p>
            )}
            <div className="flex items-center gap-1.5 mt-2">
              <code className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                syn_{k.prefix}…
              </code>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {k.grantedCapabilities.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">No capabilities granted</span>
              ) : (
                k.grantedCapabilities.map((cap) => (
                  <Badge key={cap} variant="secondary" className="text-xs font-mono">{cap}</Badge>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Created {fmt(k.createdAt)}
              {" · "}
              Last used {fmt(k.lastUsedAt)}
              {" · "}
              {k.useCount.toLocaleString()} request{k.useCount !== 1 ? "s" : ""}
              {k.expiresAt && ` · Expires ${fmt(k.expiresAt)}`}
            </p>
          </div>

          {!k.isRevoked && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive shrink-0"
              onClick={() => setRevokeTarget(k)}
            >
              <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
              Revoke
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <AdminLayout title="API Keys">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Long-lived keys for machine-to-machine access. Use{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              Authorization: Bearer syn_…
            </code>{" "}
            in request headers.
          </p>
        </div>
        <Button onClick={() => { setCreateForm(defaultCreateForm()); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          New Key
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
      ) : keys.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Key className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No API keys yet.</p>
          <p className="text-sm mt-1">
            Create a key to allow services like Orbit to call the CMS API without a browser session.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {active.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Active ({active.length})
              </h2>
              <div className="flex flex-col gap-3">
                {active.map((k) => <KeyCard key={k.id} k={k} />)}
              </div>
            </section>
          )}
          {inactive.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Revoked / Expired ({inactive.length})
              </h2>
              <div className="flex flex-col gap-3">
                {inactive.map((k) => <KeyCard key={k.id} k={k} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              The key is shown exactly once after creation. Copy it to a safe location (e.g. an
              environment variable).
            </DialogDescription>
          </DialogHeader>
          <CreateForm state={createForm} onChange={setCreateForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── One-time key reveal dialog ── */}
      <Dialog open={!!newKey} onOpenChange={(o) => { if (!o) setNewKey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              This is the only time the key is shown. Copy it now — it cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="flex flex-col gap-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Key Name</Label>
                <p className="text-sm font-medium mt-1">{newKey.name}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">API Key</Label>
                <PlaintextDisplay secret={newKey.plaintext} />
              </div>
              <div className="text-xs bg-muted/60 border rounded-md p-3 font-mono">
                Authorization: Bearer {newKey.plaintext}
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Store this key securely. It will not be shown again. Treat it like a password.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirm ── */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              Revoking <strong>{revokeTarget?.name}</strong> immediately rejects all requests using
              it. This action cannot be undone — you will need to create a new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRevoke()}
              disabled={revoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revoking ? "Revoking…" : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
