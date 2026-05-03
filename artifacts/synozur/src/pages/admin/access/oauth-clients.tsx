import { useEffect, useState, useRef } from "react";
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
import { Copy, Check, Plus, RefreshCw, ShieldOff, Pencil, Eye, EyeOff } from "lucide-react";

// #128 — OAuth 2.0 client management admin page.

interface OAuthClient {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  allowedGrantTypes: string[];
  pkceRequired: boolean;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ALL_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "content.read",
  "content.write",
  "engagements.read",
  "deliverables.read",
  "invoices.read",
] as const;

const ALL_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

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

function SecretDisplay({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex items-center gap-2 mt-2 p-3 bg-muted rounded-md font-mono text-sm break-all">
      <span className="flex-1">{visible ? secret : "•".repeat(Math.min(secret.length, 40))}</span>
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

interface ClientFormState {
  name: string;
  description: string;
  redirectUris: string;
  allowedScopes: string[];
  allowedGrantTypes: string[];
  pkceRequired: boolean;
  isActive: boolean;
}

function defaultFormState(): ClientFormState {
  return {
    name: "",
    description: "",
    redirectUris: "",
    allowedScopes: ["openid", "profile", "email"],
    allowedGrantTypes: ["authorization_code", "refresh_token"],
    pkceRequired: true,
    isActive: true,
  };
}

function clientToFormState(c: OAuthClient): ClientFormState {
  return {
    name: c.name,
    description: c.description ?? "",
    redirectUris: c.redirectUris.join("\n"),
    allowedScopes: [...c.allowedScopes],
    allowedGrantTypes: [...c.allowedGrantTypes],
    pkceRequired: c.pkceRequired,
    isActive: c.isActive,
  };
}

function ClientForm({
  state,
  onChange,
  isEdit,
}: {
  state: ClientFormState;
  onChange: (s: ClientFormState) => void;
  isEdit: boolean;
}) {
  function toggle<K extends "allowedScopes" | "allowedGrantTypes">(
    key: K,
    value: string,
  ) {
    const arr = state[key] as string[];
    const next = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
    onChange({ ...state, [key]: next });
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <Label htmlFor="cf-name">Name *</Label>
        <Input
          id="cf-name"
          value={state.name}
          onChange={(e) => onChange({ ...state, name: e.target.value })}
          placeholder="My Integration"
          className="mt-1"
        />
      </div>

      <div>
        <Label htmlFor="cf-desc">Description</Label>
        <Textarea
          id="cf-desc"
          value={state.description}
          onChange={(e) => onChange({ ...state, description: e.target.value })}
          placeholder="Optional — shown on the consent screen."
          rows={2}
          className="mt-1 resize-none"
        />
      </div>

      <div>
        <Label htmlFor="cf-uris">Redirect URIs *</Label>
        <p className="text-xs text-muted-foreground mb-1">One per line. Must be exact matches (https:// required in production).</p>
        <Textarea
          id="cf-uris"
          value={state.redirectUris}
          onChange={(e) => onChange({ ...state, redirectUris: e.target.value })}
          placeholder={"https://app.example.com/callback\nhttps://localhost:3000/callback"}
          rows={3}
          className="mt-1 resize-none font-mono text-sm"
        />
      </div>

      <div>
        <Label>Allowed Scopes *</Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {ALL_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={state.allowedScopes.includes(scope)}
                onCheckedChange={() => toggle("allowedScopes", scope)}
              />
              <span className="text-sm font-mono">{scope}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label>Grant Types *</Label>
        <div className="flex flex-col gap-2 mt-2">
          {ALL_GRANT_TYPES.map((gt) => (
            <label key={gt} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={state.allowedGrantTypes.includes(gt)}
                onCheckedChange={() => toggle("allowedGrantTypes", gt)}
              />
              <span className="text-sm font-mono">{gt}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Checkbox renders its own associated <button role="checkbox"> child. */}
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={state.pkceRequired}
            onCheckedChange={(v) => onChange({ ...state, pkceRequired: !!v })}
          />
          <span className="text-sm">Require PKCE (recommended)</span>
        </label>
      </div>

      {isEdit && (
        <div>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Radix Checkbox renders its own associated <button role="checkbox"> child. */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={state.isActive}
              onCheckedChange={(v) => onChange({ ...state, isActive: !!v })}
            />
            <span className="text-sm">Active (new authorizations allowed)</span>
          </label>
        </div>
      )}
    </div>
  );
}

export default function OAuthClientsPage() {
  const { toast } = useToast();
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ClientFormState>(defaultFormState());
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<OAuthClient | null>(null);
  const [editForm, setEditForm] = useState<ClientFormState>(defaultFormState());
  const [editing, setEditing] = useState(false);

  const [newSecret, setNewSecret] = useState<{ clientId: string; secret: string; context: "create" | "rotate" } | null>(null);

  const [rotateTarget, setRotateTarget] = useState<OAuthClient | null>(null);
  const [rotating, setRotating] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<OAuthClient | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<OAuthClient[]>("/cms/oauth/clients");
      setClients(data);
    } catch (err) {
      toast({ title: "Failed to load clients", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function validateForm(f: ClientFormState): string | null {
    if (!f.name.trim()) return "Name is required.";
    const uris = f.redirectUris.split("\n").map((u) => u.trim()).filter(Boolean);
    if (uris.length === 0) return "At least one redirect URI is required.";
    if (f.allowedScopes.length === 0) return "At least one scope is required.";
    if (f.allowedGrantTypes.length === 0) return "At least one grant type is required.";
    return null;
  }

  async function handleCreate() {
    const err = validateForm(createForm);
    if (err) { toast({ title: "Validation error", description: err, variant: "destructive" }); return; }
    setCreating(true);
    try {
      const body = {
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        redirectUris: createForm.redirectUris.split("\n").map((u) => u.trim()).filter(Boolean),
        allowedScopes: createForm.allowedScopes,
        allowedGrantTypes: createForm.allowedGrantTypes,
        pkceRequired: createForm.pkceRequired,
      };
      const res = await apiFetch<{ client: OAuthClient; clientSecret: string }>("/cms/oauth/clients", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setClients((prev) => [...prev, res.client].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateOpen(false);
      setCreateForm(defaultFormState());
      setNewSecret({ clientId: res.client.clientId, secret: res.clientSecret, context: "create" });
    } catch (err) {
      toast({ title: "Failed to create client", description: String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    const err = validateForm(editForm);
    if (err) { toast({ title: "Validation error", description: err, variant: "destructive" }); return; }
    setEditing(true);
    try {
      const body = {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        redirectUris: editForm.redirectUris.split("\n").map((u) => u.trim()).filter(Boolean),
        allowedScopes: editForm.allowedScopes,
        allowedGrantTypes: editForm.allowedGrantTypes,
        pkceRequired: editForm.pkceRequired,
        isActive: editForm.isActive,
      };
      const updated = await apiFetch<OAuthClient>(`/cms/oauth/clients/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditTarget(null);
      toast({ title: "Client updated" });
    } catch (err) {
      toast({ title: "Failed to update client", description: String(err), variant: "destructive" });
    } finally {
      setEditing(false);
    }
  }

  async function handleRotate() {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const res = await apiFetch<{ clientId: string; clientSecret: string }>(
        `/cms/oauth/clients/${rotateTarget.id}/rotate-secret`,
        { method: "POST" },
      );
      setRotateTarget(null);
      setNewSecret({ clientId: res.clientId, secret: res.clientSecret, context: "rotate" });
    } catch (err) {
      toast({ title: "Failed to rotate secret", description: String(err), variant: "destructive" });
    } finally {
      setRotating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await apiFetch(`/cms/oauth/clients/${revokeTarget.id}/revoke`, { method: "POST" });
      setRevokeTarget(null);
      toast({ title: "All active tokens revoked", description: `${revokeTarget.name} sessions ended.` });
    } catch (err) {
      toast({ title: "Failed to revoke tokens", description: String(err), variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  function fmt(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <AdminLayout title="OAuth Clients">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">OAuth Clients</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Applications that authenticate users via this site as an identity provider.
          </p>
        </div>
        <Button onClick={() => { setCreateForm(defaultFormState()); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          New Client
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
      ) : clients.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p className="font-medium">No OAuth clients registered yet.</p>
          <p className="text-sm mt-1">Create one to allow external apps to authenticate against this site.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {clients.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{c.name}</span>
                    {!c.isActive && <Badge variant="destructive">Inactive</Badge>}
                  </div>
                  {c.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{c.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{c.clientId}</span>
                    <CopyButton value={c.clientId} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.allowedScopes.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs font-mono">{s}</Badge>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.allowedGrantTypes.map((g) => (
                      <Badge key={g} variant="outline" className="text-xs font-mono">{g}</Badge>
                    ))}
                    {c.pkceRequired && (
                      <Badge variant="outline" className="text-xs">PKCE required</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Created {fmt(c.createdAt)} · Last used {fmt(c.lastUsedAt)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditTarget(c); setEditForm(clientToFormState(c)); }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRotateTarget(c)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Rotate Secret
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRevokeTarget(c)}
                  >
                    <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                    Revoke Tokens
                  </Button>
                </div>
              </div>

              {c.redirectUris.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Redirect URIs</p>
                  <ul className="space-y-0.5">
                    {c.redirectUris.map((u) => (
                      <li key={u} className="font-mono text-xs text-muted-foreground">{u}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register OAuth Client</DialogTitle>
            <DialogDescription>
              The client secret is shown exactly once after creation. Copy it to a safe location.
            </DialogDescription>
          </DialogHeader>
          <ClientForm state={createForm} onChange={setCreateForm} isEdit={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit OAuth Client</DialogTitle>
          </DialogHeader>
          <ClientForm state={editForm} onChange={setEditForm} isEdit={true} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleEdit()} disabled={editing}>
              {editing ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New/rotated secret reveal dialog ── */}
      <Dialog open={!!newSecret} onOpenChange={(o) => { if (!o) setNewSecret(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {newSecret?.context === "create" ? "Client Created" : "Secret Rotated"}
            </DialogTitle>
            <DialogDescription>
              This is the only time the secret is shown. Copy it now — it cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          {newSecret && (
            <div className="flex flex-col gap-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Client ID</Label>
                <div className="flex items-center font-mono text-sm mt-1">
                  {newSecret.clientId}
                  <CopyButton value={newSecret.clientId} />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Client Secret</Label>
                <SecretDisplay secret={newSecret.secret} />
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Store this secret securely (e.g. environment variable). It will not be shown again.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setNewSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rotate secret confirm ── */}
      <AlertDialog open={!!rotateTarget} onOpenChange={(o) => { if (!o) setRotateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate client secret?</AlertDialogTitle>
            <AlertDialogDescription>
              A new secret will be generated for <strong>{rotateTarget?.name}</strong>. The existing
              secret stops working immediately. Make sure you update the secret in the consuming
              application before confirming.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRotate()} disabled={rotating}>
              {rotating ? "Rotating…" : "Rotate Secret"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Revoke tokens confirm ── */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all tokens?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately invalidates all active refresh tokens for{" "}
              <strong>{revokeTarget?.name}</strong>. Signed-in users will need to re-authorize.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRevoke()}
              disabled={revoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revoking ? "Revoking…" : "Revoke All Tokens"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
