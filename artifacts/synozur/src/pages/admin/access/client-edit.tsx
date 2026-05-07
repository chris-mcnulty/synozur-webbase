import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AppLink } from "@/components/ui/app-link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// #225 — Client-org create/edit + member management. Mounts at
// /access/clients/new and /access/clients/:id.

const ROLES = [
  "admin", "editor", "author", "contributor", "client",
  "site_admin", "content_author", "hr", "internal", "customer",
  "registered", "account_manager",
] as const;
type RoleName = (typeof ROLES)[number];

interface Member {
  membershipId: string | null;
  userId: string;
  email: string | null;
  displayName: string | null;
  authProvider: string | null;
  role: "member" | "primary_contact";
  lastSignInAt: string | null;
  emailVerified: boolean | null;
}

interface PendingInvite {
  token: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

interface ClientOrg {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  defaultRoleId: string | null;
  defaultRoleName: string | null;
  accountManagerUserId: string | null;
  accountManagerName: string | null;
  accountManagerEmail: string | null;
  entraTenantId: string | null;
  entraTenantName: string | null;
  approvedEmailDomains: string[] | null;
  notes: string | null;
  constellationClientId: string | null;
  members: Member[];
  pendingInvitations: PendingInvite[];
}

const PORTAL_SOURCE_APPS = ["vega", "nebula", "constellation", "orion", "orbit", "zenith"] as const;
type PortalSourceApp = (typeof PORTAL_SOURCE_APPS)[number];

interface PortalArtifact {
  id: string;
  clientOrganizationId: string;
  sourceApp: PortalSourceApp;
  artifactKind: string;
  title: string;
  summary: string | null;
  externalUrl: string | null;
  archivedAt: string | null;
}

const EMPTY_ARTIFACT_FORM = {
  sourceApp: "constellation" as PortalSourceApp,
  artifactKind: "",
  title: "",
  summary: "",
  externalUrl: "",
};

interface AdminUserListItem {
  id: string;
  email: string | null;
  displayName: string | null;
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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function ClientEditPage({ id }: { id?: string } = {}) {
  const isNew = !id;
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [org, setOrg] = useState<ClientOrg | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Default to `customer` so freshly-onboarded members hit Galaxy's
  // `requireCustomerAudience` gate without operator intervention. (#225)
  const [defaultRole, setDefaultRole] = useState<RoleName | "">("customer");
  const [accountManagerUserId, setAccountManagerUserId] = useState<string>("");
  const [entraTenantId, setEntraTenantId] = useState("");
  const [entraTenantName, setEntraTenantName] = useState("");
  const [domainsCsv, setDomainsCsv] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [constellationClientId, setConstellationClientId] = useState("");

  // Portal artifacts
  const [artifacts, setArtifacts] = useState<PortalArtifact[]>([]);
  const [artifactForm, setArtifactForm] = useState({ ...EMPTY_ARTIFACT_FORM });
  const [artifactSaving, setArtifactSaving] = useState(false);

  // Invite form state.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "primary_contact">("member");
  const [inviting, setInviting] = useState(false);

  // Existing-user assignment.
  const [assignEmail, setAssignEmail] = useState("");
  const [assignRole, setAssignRole] = useState<"member" | "primary_contact">("member");
  const [assigning, setAssigning] = useState(false);

  // Account-manager picker source. We piggy-back on the existing users list
  // endpoint so account managers can search by email/display name.
  const [staffOptions, setStaffOptions] = useState<AdminUserListItem[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<{ items: AdminUserListItem[] }>("/admin/client-orgs/_lookup/staff");
        setStaffOptions(res.items);
      } catch {
        // Non-fatal — falls back to UUID input below.
      }
    })();
  }, []);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiFetch<ClientOrg>(`/admin/client-orgs/${id}`);
      setOrg(data);
      setName(data.name);
      setSlug(data.slug);
      setDefaultRole((data.defaultRoleName as RoleName) ?? "");
      setAccountManagerUserId(data.accountManagerUserId ?? "");
      setEntraTenantId(data.entraTenantId ?? "");
      setEntraTenantName(data.entraTenantName ?? "");
      setDomainsCsv((data.approvedEmailDomains ?? []).join(", "));
      setNotes(data.notes ?? "");
      setIsActive(data.isActive);
      setConstellationClientId(data.constellationClientId ?? "");
      await loadArtifacts(id);
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
  useEffect(() => { void load(); }, [id]);

  const orgPayload = useMemo(
    () => ({
      name: name.trim(),
      slug: slug.trim(),
      defaultRole: defaultRole || null,
      accountManagerUserId: accountManagerUserId || null,
      entraTenantId: entraTenantId.trim() || null,
      entraTenantName: entraTenantName.trim() || null,
      approvedEmailDomains: domainsCsv.split(",").map((d) => d.trim()).filter(Boolean),
      notes: notes.trim() || null,
      isActive,
      constellationClientId: constellationClientId.trim() || null,
    }),
    [name, slug, defaultRole, accountManagerUserId, entraTenantId, entraTenantName, domainsCsv, notes, isActive, constellationClientId],
  );

  async function loadArtifacts(orgId: string) {
    try {
      const data = await apiFetch<{ items: PortalArtifact[] }>(`/cms/portal-artifacts?clientOrganizationId=${orgId}`);
      setArtifacts(data.items);
    } catch { /* non-fatal */ }
  }

  async function createArtifact() {
    if (!id || !artifactForm.title.trim() || !artifactForm.artifactKind.trim()) return;
    setArtifactSaving(true);
    try {
      await apiFetch("/cms/portal-artifacts", {
        method: "POST",
        body: JSON.stringify({
          clientOrganizationId: id,
          sourceApp: artifactForm.sourceApp,
          artifactKind: artifactForm.artifactKind.trim(),
          title: artifactForm.title.trim(),
          summary: artifactForm.summary.trim() || null,
          externalUrl: artifactForm.externalUrl.trim() || null,
        }),
      });
      setArtifactForm({ ...EMPTY_ARTIFACT_FORM });
      toast({ title: "Artifact published" });
      await loadArtifacts(id);
    } catch (e) {
      toast({ title: "Publish failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setArtifactSaving(false);
    }
  }

  async function archiveArtifact(artifactId: string) {
    if (!id) return;
    try {
      await apiFetch(`/cms/portal-artifacts/${artifactId}/archive`, { method: "POST" });
      await loadArtifacts(id);
    } catch (e) {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function deleteArtifact(artifactId: string) {
    if (!id) return;
    if (!confirm("Delete this artifact? It will be hidden from the customer portal.")) return;
    try {
      await apiFetch(`/cms/portal-artifacts/${artifactId}`, { method: "DELETE" });
      await loadArtifacts(id);
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function save() {
    if (!orgPayload.name || !orgPayload.slug) {
      toast({ title: "Name and slug are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await apiFetch<{ id: string }>("/admin/client-orgs", {
          method: "POST",
          body: JSON.stringify(orgPayload),
        });
        toast({ title: "Client organization created" });
        navigate(`/access/clients/${created.id}`);
      } else {
        await apiFetch(`/admin/client-orgs/${id}`, {
          method: "PATCH",
          body: JSON.stringify(orgPayload),
        });
        toast({ title: "Saved" });
        await load();
      }
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

  async function invite() {
    if (!id) return;
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await apiFetch(`/admin/client-orgs/${id}/invite`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          displayName: inviteName.trim() || undefined,
          role: inviteRole,
        }),
      });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      toast({ title: "Invitation sent" });
      await load();
    } catch (e) {
      toast({
        title: "Invite failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  }

  async function assignExisting() {
    if (!id) return;
    if (!assignEmail.trim()) return;
    setAssigning(true);
    try {
      await apiFetch(`/admin/client-orgs/${id}/users`, {
        method: "POST",
        body: JSON.stringify({
          email: assignEmail.trim(),
          role: assignRole,
        }),
      });
      setAssignEmail("");
      setAssignRole("member");
      toast({ title: "User added" });
      await load();
    } catch (e) {
      toast({
        title: "Add failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setAssigning(false);
    }
  }

  async function removeMember(userId: string) {
    if (!id) return;
    if (!confirm("Remove this user from the organization? They will lose any access granted via this org.")) return;
    try {
      await apiFetch(`/admin/client-orgs/${id}/users/${userId}`, { method: "DELETE" });
      toast({ title: "User removed" });
      await load();
    } catch (e) {
      toast({
        title: "Remove failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  async function softDelete() {
    if (!id) return;
    if (!confirm("Delete this client organization? Members will lose access. (Soft-delete; can be restored from the database.)")) return;
    try {
      await apiFetch(`/admin/client-orgs/${id}`, { method: "DELETE" });
      toast({ title: "Organization deleted" });
      navigate("/access/clients");
    } catch (e) {
      toast({
        title: "Delete failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  return (
    <AdminLayout
      title={isNew ? "New client organization" : (org?.name ?? "Client organization")}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Access" },
        { label: "Organizations", href: "/access/clients" },
        { label: isNew ? "New" : (org?.name ?? "…") },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <AppLink href="/access/clients" unstyled>Back</AppLink>
          </Button>
          <Button onClick={save} disabled={saving} data-testid="button-save-client-org">
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Org details */}
          <Card className="p-6 lg:col-span-2 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-name">Organization name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (isNew) setSlug(slugify(e.target.value));
                  }}
                  placeholder="Acme Corp"
                  data-testid="input-client-org-name"
                />
              </div>
              <div>
                <Label htmlFor="org-slug">Slug</Label>
                <Input
                  id="org-slug"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder="acme-corp"
                  data-testid="input-client-org-slug"
                />
              </div>
              <div>
                <Label htmlFor="org-role">Default role for members</Label>
                <select
                  id="org-role"
                  value={defaultRole}
                  onChange={(e) => setDefaultRole(e.target.value as RoleName | "")}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  data-testid="select-default-role"
                >
                  <option value="">— none —</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="org-am">Account manager</Label>
                {staffOptions.length > 0 ? (
                  <select
                    id="org-am"
                    value={accountManagerUserId}
                    onChange={(e) => setAccountManagerUserId(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    data-testid="select-account-manager"
                  >
                    <option value="">— unassigned —</option>
                    {staffOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName ?? u.email ?? u.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="org-am"
                    value={accountManagerUserId}
                    onChange={(e) => setAccountManagerUserId(e.target.value)}
                    placeholder="User UUID"
                  />
                )}
              </div>
              <div>
                <Label htmlFor="org-tenant">Entra tenant ID</Label>
                <Input
                  id="org-tenant"
                  value={entraTenantId}
                  onChange={(e) => setEntraTenantId(e.target.value)}
                  placeholder="GUID, optional"
                />
              </div>
              <div>
                <Label htmlFor="org-tenant-name">Entra tenant name</Label>
                <Input
                  id="org-tenant-name"
                  value={entraTenantName}
                  onChange={(e) => setEntraTenantName(e.target.value)}
                  placeholder="Acme Corp (Azure AD)"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="org-domains">Approved email domains (comma-separated)</Label>
                <Input
                  id="org-domains"
                  value={domainsCsv}
                  onChange={(e) => setDomainsCsv(e.target.value)}
                  placeholder="acmecorp.com, acme.io"
                />
              </div>
              <div>
                <Label htmlFor="org-constellation-id">Constellation client ID</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="org-constellation-id"
                    value={constellationClientId}
                    onChange={(e) => setConstellationClientId(e.target.value)}
                    placeholder="SCDP client UUID, optional"
                    className="font-mono text-xs"
                  />
                  {constellationClientId.trim() && (
                    <span className="shrink-0 text-xs text-emerald-600 font-medium">✓ linked</span>
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="org-notes">Notes</Label>
                <Input
                  id="org-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional internal notes"
                />
              </div>
              <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  data-testid="checkbox-is-active"
                />
                Active (members can sign in and receive their default role)
              </label>
            </div>
            {!isNew && (
              <div className="pt-3 border-t">
                <Button variant="ghost" className="text-destructive" onClick={softDelete}>
                  Delete organization
                </Button>
              </div>
            )}
          </Card>

          {/* Members + invites */}
          {!isNew && org && (
            <div className="space-y-6">
              <Card className="p-6 space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Invite a new user
                </h2>
                <div className="space-y-2">
                  <Input
                    placeholder="email@client.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    data-testid="input-invite-email"
                  />
                  <Input
                    placeholder="Display name (optional)"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "member" | "primary_contact")}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="member">Member</option>
                    <option value="primary_contact">Primary contact</option>
                  </select>
                  <Button
                    onClick={invite}
                    disabled={inviting || !inviteEmail.trim()}
                    className="w-full"
                    data-testid="button-send-invite"
                  >
                    {inviting ? "Sending…" : "Send invitation email"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll email a single-use link the recipient can use to set their password and sign in.
                  The link expires in 7 days.
                </p>
              </Card>

              <Card className="p-6 space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Add an existing user
                </h2>
                <Input
                  placeholder="email@somewhere.com"
                  value={assignEmail}
                  onChange={(e) => setAssignEmail(e.target.value)}
                  data-testid="input-assign-email"
                />
                <select
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value as "member" | "primary_contact")}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="primary_contact">Primary contact</option>
                </select>
                <Button
                  variant="outline"
                  onClick={assignExisting}
                  disabled={assigning || !assignEmail.trim()}
                  className="w-full"
                  data-testid="button-assign-existing"
                >
                  {assigning ? "Adding…" : "Add to organization"}
                </Button>
              </Card>
            </div>
          )}

          {/* Member roster */}
          {!isNew && org && (
            <Card className="p-6 lg:col-span-3 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Members ({org.members.length})
              </h2>
              {org.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2">User</th>
                        <th className="text-left px-3 py-2">Role</th>
                        <th className="text-left px-3 py-2">Auth</th>
                        <th className="text-left px-3 py-2">Last sign-in</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {org.members.map((m) => (
                        <tr key={m.userId} className="border-t border-border">
                          <td className="px-3 py-2">
                            <div className="font-medium">{m.displayName ?? m.email ?? m.userId}</div>
                            {m.displayName && m.email && (
                              <div className="text-xs text-muted-foreground">{m.email}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {m.role === "primary_contact"
                              ? <Badge>Primary contact</Badge>
                              : <Badge variant="outline">Member</Badge>}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {m.authProvider ?? "—"}
                            {m.emailVerified === false && (
                              <Badge variant="outline" className="ml-2 text-xs">unverified</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {m.lastSignInAt ? new Date(m.lastSignInAt).toLocaleString() : "Never"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMember(m.userId)}
                              data-testid={`button-remove-${m.userId}`}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {org.pendingInvitations.length > 0 && (
                <div className="pt-3 border-t">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Pending invitations
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {org.pendingInvitations.map((inv) => (
                      <li key={inv.token} className="flex items-center gap-3">
                        <span className="flex-1">{inv.email}</span>
                        <Badge variant="outline" className="text-xs">{inv.role}</Badge>
                        <span className="text-xs text-muted-foreground">
                          expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* Portal artifacts */}
          {!isNew && org && (
            <Card className="p-6 lg:col-span-3 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Portal artifacts
              </h2>

              {/* Add new artifact form */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pb-4 border-b">
                <div>
                  <Label>Source app</Label>
                  <select
                    value={artifactForm.sourceApp}
                    onChange={(e) => setArtifactForm((f) => ({ ...f, sourceApp: e.target.value as PortalSourceApp }))}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {PORTAL_SOURCE_APPS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Kind</Label>
                  <Input
                    value={artifactForm.artifactKind}
                    onChange={(e) => setArtifactForm((f) => ({ ...f, artifactKind: e.target.value }))}
                    placeholder="e.g. project, invoice, report"
                  />
                </div>
                <div>
                  <Label>Title</Label>
                  <Input
                    value={artifactForm.title}
                    onChange={(e) => setArtifactForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Artifact title"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Summary (optional)</Label>
                  <Input
                    value={artifactForm.summary}
                    onChange={(e) => setArtifactForm((f) => ({ ...f, summary: e.target.value }))}
                    placeholder="Short description shown in the portal"
                  />
                </div>
                <div>
                  <Label>External URL (optional)</Label>
                  <Input
                    value={artifactForm.externalUrl}
                    onChange={(e) => setArtifactForm((f) => ({ ...f, externalUrl: e.target.value }))}
                    placeholder="https://…"
                  />
                </div>
                <div className="md:col-span-3">
                  <Button
                    onClick={createArtifact}
                    disabled={artifactSaving || !artifactForm.title.trim() || !artifactForm.artifactKind.trim()}
                    data-testid="button-publish-artifact"
                  >
                    {artifactSaving ? "Publishing…" : "Publish artifact"}
                  </Button>
                </div>
              </div>

              {/* Artifact list */}
              {artifacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No artifacts yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2">Title</th>
                        <th className="text-left px-3 py-2">Kind</th>
                        <th className="text-left px-3 py-2">Source</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {artifacts.map((a) => (
                        <tr key={a.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <div className="font-medium">{a.title}</div>
                            {a.summary && <div className="text-xs text-muted-foreground">{a.summary}</div>}
                            {a.externalUrl && (
                              <a
                                href={a.externalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary underline"
                              >
                                {a.externalUrl}
                              </a>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{a.artifactKind}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline">{a.sourceApp}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            {a.archivedAt
                              ? <Badge variant="secondary">Archived</Badge>
                              : <Badge>Live</Badge>}
                          </td>
                          <td className="px-3 py-2 text-right space-x-1">
                            {!a.archivedAt && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => archiveArtifact(a.id)}
                              >
                                Archive
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => deleteArtifact(a.id)}
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
