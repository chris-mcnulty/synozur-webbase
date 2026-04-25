import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// #126: Entra group → CMS role mapping. Group object-ids are pasted in by the
// admin (read off the Entra portal) and reconciled on each user's next sign-in.

interface Mapping {
  id: string;
  entraGroupId: string;
  entraGroupName: string | null;
  roleName: string;
  roleId: string;
  createdAt: string;
}

const ROLES = ["admin", "editor", "author", "contributor"] as const;

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

export default function EntraMappingsPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [role, setRole] = useState<typeof ROLES[number]>("editor");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: Mapping[] }>("/admin/entra/group-mappings");
      setItems(data.items);
    } catch (e) {
      toast({ title: "Load failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function add() {
    if (!groupId.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/admin/entra/group-mappings", {
        method: "POST",
        body: JSON.stringify({
          entraGroupId: groupId.trim(),
          entraGroupName: groupName.trim() || null,
          role,
        }),
      });
      setGroupId("");
      setGroupName("");
      toast({ title: "Mapping added" });
      await refresh();
    } catch (e) {
      toast({ title: "Add failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/admin/entra/group-mappings/${id}`, { method: "DELETE" });
      toast({ title: "Mapping removed" });
      await refresh();
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <AdminLayout
      title="Entra group mappings"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Access" }, { label: "Entra mappings" }]}
    >
      <Card className="p-6 mb-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Map Microsoft Entra security-group object-ids to CMS roles. On each
          sign-in the user's transitive group membership is resolved and roles
          are reconciled — adding the new grants and removing any role grant
          that was previously sourced from a group the user no longer belongs
          to.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label htmlFor="entra-group-id">Group object id</Label>
            <Input
              id="entra-group-id"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div>
            <Label htmlFor="entra-group-name">Display name (optional)</Label>
            <Input
              id="entra-group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Synozur-Editors"
            />
          </div>
          <div>
            <Label htmlFor="entra-role">Role</Label>
            <select
              id="entra-role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof ROLES[number])}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={add} disabled={saving || !groupId.trim()}>Add mapping</Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No mappings configured yet.</Card>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <Card key={m.id} className="p-4 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[280px]">
                <div className="font-mono text-xs text-muted-foreground">{m.entraGroupId}</div>
                <div className="text-sm font-medium">{m.entraGroupName ?? "—"}</div>
              </div>
              <Badge>{m.roleName}</Badge>
              <Button variant="ghost" size="sm" onClick={() => remove(m.id)}>Remove</Button>
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
