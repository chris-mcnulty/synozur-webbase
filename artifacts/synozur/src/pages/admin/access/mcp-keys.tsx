import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Copy, Check, Plus, ShieldOff, Eye, EyeOff, Plug } from "lucide-react";

// MCP Keys admin page — API keys scoped to mcp.read or mcp.write for the
// Synozur www MCP server. Each external application (e.g. Orbit production,
// Orbit staging) should have its own key so access can be revoked independently.

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

type McpPermission = "mcp.read" | "mcp.write";

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

export default function McpKeysPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permission, setPermission] = useState<McpPermission>("mcp.read");
  const [creating, setCreating] = useState(false);

  const [newKey, setNewKey] = useState<{ name: string; plaintext: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function load() {
    try {
      const all = await apiFetch<ApiKey[]>("/cms/api-keys");
      // Show only keys that have mcp.read or mcp.write capability.
      setKeys(all.filter((k) => k.grantedCapabilities.some((c) => c === "mcp.read" || c === "mcp.write")));
    } catch (err) {
      toast({ title: "Failed to load MCP keys", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function resetForm() {
    setName("");
    setDescription("");
    setPermission("mcp.read");
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Application name is required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        grantedCapabilities: [permission],
      };
      if (description.trim()) body.description = description.trim();

      const res = await apiFetch<CreateResponse>("/cms/api-keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setKeys((prev) => [...prev, res].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateOpen(false);
      resetForm();
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

  function permissionLabel(caps: string[]) {
    if (caps.includes("mcp.write")) return { label: "Read + Write", variant: "default" as const };
    return { label: "Read only", variant: "secondary" as const };
  }

  function KeyCard({ k }: { k: ApiKey }) {
    const perm = permissionLabel(k.grantedCapabilities);
    return (
      <Card className={`p-5 ${k.isRevoked || k.isExpired ? "opacity-60" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Plug className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold">{k.name}</span>
              <Badge variant={perm.variant} className="text-xs">{perm.label}</Badge>
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
            <p className="text-xs text-muted-foreground mt-2">
              Created {fmt(k.createdAt)}
              {" · "}
              Last used {fmt(k.lastUsedAt)}
              {" · "}
              {k.useCount.toLocaleString()} request{k.useCount !== 1 ? "s" : ""}
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
    <AdminLayout title="MCP Keys">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">MCP Keys</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Issue keys to external AI applications that connect to the Synozur www MCP server at{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">POST /api/mcp</code>.
            Each application should have its own key so access can be revoked independently.
          </p>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          New Key
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
      ) : keys.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Plug className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No MCP keys yet.</p>
          <p className="text-sm mt-1">
            Create a key for each application that needs to call the Synozur www MCP server.
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
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetForm(); setCreateOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New MCP Key</DialogTitle>
            <DialogDescription>
              The key is shown exactly once after creation. Copy it to a secure location before closing.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label htmlFor="mcp-name">Application name *</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Orbit Production"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use a name that identifies the specific deployment (e.g. "Orbit Staging", "Orbit Prod").
              </p>
            </div>

            <div>
              <Label htmlFor="mcp-desc">Description</Label>
              <Textarea
                id="mcp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What uses this key and why?"
                rows={2}
                className="mt-1 resize-none"
              />
            </div>

            <div>
              <Label>Access level</Label>
              <RadioGroup
                value={permission}
                onValueChange={(v) => setPermission(v as McpPermission)}
                className="mt-2 flex flex-col gap-2"
              >
                <label htmlFor="perm-read" className="flex items-start gap-3 cursor-pointer rounded-md border p-3 hover:bg-muted/50 transition-colors has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="mcp.read" id="perm-read" className="mt-0.5" />
                  <div>
                    <span className="text-sm font-medium">Read only</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Browse posts, events, episodes, media, and taxonomy. Cannot create content or upload images.
                    </p>
                  </div>
                </label>
                <label htmlFor="perm-write" className="flex items-start gap-3 cursor-pointer rounded-md border p-3 hover:bg-muted/50 transition-colors has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="mcp.write" id="perm-write" className="mt-0.5" />
                  <div>
                    <span className="text-sm font-medium">Read + Write</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      All read access plus: create draft posts, schedule posts, upload images.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── One-time key reveal ── */}
      <Dialog open={!!newKey} onOpenChange={(o) => { if (!o) setNewKey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>MCP Key Created</DialogTitle>
            <DialogDescription>
              This is the only time the key is shown. Copy it now — it cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="flex flex-col gap-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Application</Label>
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
              Revoking <strong>{revokeTarget?.name}</strong> immediately blocks all requests using it.
              This cannot be undone — you will need to issue a new key to that application.
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
