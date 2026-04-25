import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// Admin CRUD for client organizations. An organization is the unit of portal
// access — any user linked to an active org (via Entra SSO tenant, approved
// email domain, or admin assignment) automatically gets the org's default role.

const ROLES = ["admin", "editor", "author", "contributor", "client"] as const;
type RoleName = (typeof ROLES)[number];

interface Org {
  id: string;
  name: string;
  slug: string;
  entraTenantId: string | null;
  entraTenantName: string | null;
  approvedEmailDomains: string[] | null;
  isActive: boolean;
  defaultRoleId: string | null;
  defaultRoleName: string | null;
  notes: string | null;
  createdAt: string;
}

interface Member {
  id: string;
  email: string | null;
  displayName: string | null;
  authProvider: string | null;
  lastSignInAt: string | null;
  createdAt: string;
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
      try { const j = (await r.json()) as { error?: string }; if (j.error) detail = j.error; } catch { /* ignore */ }
      throw new Error(`${r.status} ${detail}`);
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const EMPTY_FORM = {
  name: "",
  slug: "",
  entraTenantId: "",
  entraTenantName: "",
  approvedEmailDomains: "",
  isActive: true,
  defaultRole: "client" as RoleName | "",
  notes: "",
};

export default function OrganizationsPage() {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [assignEmail, setAssignEmail] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: Org[] }>("/admin/client-orgs");
      setOrgs(data.items);
    } catch (e) {
      toast({ title: "Load failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function loadMembers(orgId: string) {
    try {
      const data = await apiFetch<{ items: Member[] }>(`/admin/client-orgs/${orgId}/members`);
      setMembers((m) => ({ ...m, [orgId]: data.items }));
    } catch (e) {
      toast({ title: "Members load failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  function toggleExpand(orgId: string) {
    if (expandedOrg === orgId) {
      setExpandedOrg(null);
    } else {
      setExpandedOrg(orgId);
      void loadMembers(orgId);
    }
  }

  async function create() {
    if (!form.name.trim() || !form.slug.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/admin/client-orgs", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          entraTenantId: form.entraTenantId.trim() || null,
          entraTenantName: form.entraTenantName.trim() || null,
          approvedEmailDomains: form.approvedEmailDomains.split(",").map((d) => d.trim()).filter(Boolean),
          isActive: form.isActive,
          defaultRole: form.defaultRole || null,
          notes: form.notes.trim() || null,
        }),
      });
      setForm({ ...EMPTY_FORM });
      toast({ title: "Organization created" });
      await refresh();
    } catch (e) {
      toast({ title: "Create failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(org: Org) {
    try {
      await apiFetch(`/admin/client-orgs/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !org.isActive }),
      });
      toast({ title: org.isActive ? "Organization deactivated" : "Organization activated" });
      await refresh();
    } catch (e) {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this organization? Members will lose their org association.")) return;
    try {
      await apiFetch(`/admin/client-orgs/${id}`, { method: "DELETE" });
      toast({ title: "Organization deleted" });
      await refresh();
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function assignUser(orgId: string) {
    const email = (assignEmail[orgId] ?? "").trim();
    if (!email) return;
    // Look up user by email via the users admin API, then assign.
    // We use the org-member endpoint which accepts userId; but the admin needs
    // to supply the user UUID. For now, we let them paste the UUID directly.
    try {
      await apiFetch(`/admin/client-orgs/${orgId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: email }), // admin pastes UUID
      });
      setAssignEmail((a) => ({ ...a, [orgId]: "" }));
      toast({ title: "User assigned" });
      await loadMembers(orgId);
    } catch (e) {
      toast({ title: "Assign failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function removeUser(orgId: string, userId: string) {
    try {
      await apiFetch(`/admin/client-orgs/${orgId}/members/${userId}`, { method: "DELETE" });
      toast({ title: "User removed from organization" });
      await loadMembers(orgId);
    } catch (e) {
      toast({ title: "Remove failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <AdminLayout
      title="Client organizations"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Access" }, { label: "Organizations" }]}
    >
      {/* Create form */}
      <Card className="p-6 mb-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Organizations are the unit of client access. Any user linked to an active organization —
          via Entra SSO, approved email domain, or admin assignment — automatically receives the
          org's default role on every sign-in.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <Label htmlFor="org-slug">Slug (URL-safe identifier)</Label>
            <Input
              id="org-slug"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
              placeholder="acme-corp"
            />
          </div>
          <div>
            <Label htmlFor="org-tenant">Entra tenant ID (GUID, for SSO)</Label>
            <Input
              id="org-tenant"
              value={form.entraTenantId}
              onChange={(e) => setForm((f) => ({ ...f, entraTenantId: e.target.value }))}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </div>
          <div>
            <Label htmlFor="org-tenant-name">Entra tenant display name</Label>
            <Input
              id="org-tenant-name"
              value={form.entraTenantName}
              onChange={(e) => setForm((f) => ({ ...f, entraTenantName: e.target.value }))}
              placeholder="Acme Corp (Azure AD)"
            />
          </div>
          <div>
            <Label htmlFor="org-domains">Approved email domains (comma-separated)</Label>
            <Input
              id="org-domains"
              value={form.approvedEmailDomains}
              onChange={(e) => setForm((f) => ({ ...f, approvedEmailDomains: e.target.value }))}
              placeholder="acmecorp.com, acme.io"
            />
          </div>
          <div>
            <Label htmlFor="org-role">Default role granted to members</Label>
            <select
              id="org-role"
              value={form.defaultRole}
              onChange={(e) => setForm((f) => ({ ...f, defaultRole: e.target.value as RoleName | "" }))}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— none —</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="org-notes">Notes</Label>
            <Input
              id="org-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional internal notes"
            />
          </div>
        </div>
        <Button onClick={create} disabled={saving || !form.name.trim() || !form.slug.trim()}>
          Add organization
        </Button>
      </Card>

      {/* List */}
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : orgs.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No organizations configured yet.</Card>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <Card key={org.id} className="p-4 space-y-3">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{org.name}</span>
                    <Badge variant="outline" className="text-xs">{org.slug}</Badge>
                    {!org.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  {org.entraTenantId && (
                    <div className="font-mono text-xs text-muted-foreground mt-1">
                      Entra: {org.entraTenantId}{org.entraTenantName ? ` · ${org.entraTenantName}` : ""}
                    </div>
                  )}
                  {(org.approvedEmailDomains ?? []).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Domains: {(org.approvedEmailDomains ?? []).join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {org.defaultRoleName && <Badge>{org.defaultRoleName}</Badge>}
                  <Button variant="outline" size="sm" onClick={() => toggleExpand(org.id)}>
                    {expandedOrg === org.id ? "Hide members" : "Members"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(org)}>
                    {org.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(org.id)}>
                    Delete
                  </Button>
                </div>
              </div>

              {expandedOrg === org.id && (
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Members</p>
                  {(members[org.id] ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {(members[org.id] ?? []).map((m) => (
                        <div key={m.id} className="flex items-center gap-3 text-sm">
                          <div className="flex-1">
                            <span className="font-medium">{m.displayName ?? m.email ?? m.id}</span>
                            {m.email && m.displayName && <span className="text-muted-foreground ml-2">{m.email}</span>}
                            {m.authProvider && <Badge variant="outline" className="ml-2 text-xs">{m.authProvider}</Badge>}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => removeUser(org.id, m.id)}>Remove</Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Input
                      placeholder="Paste user UUID to assign…"
                      value={assignEmail[org.id] ?? ""}
                      onChange={(e) => setAssignEmail((a) => ({ ...a, [org.id]: e.target.value }))}
                      className="max-w-sm text-sm"
                    />
                    <Button size="sm" variant="outline" onClick={() => assignUser(org.id)}>
                      Assign user
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
