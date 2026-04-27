import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useToast } from "@/hooks/use-toast";

// #111 — DB-backed role → capability editor.

interface CapabilityRow {
  id: string;
  name: string;
  description: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
}

interface CapabilitiesResponse {
  capabilities: CapabilityRow[];
  roles: RoleRow[];
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

export default function CapabilitiesPage() {
  const { toast } = useToast();
  const [data, setData] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<CapabilitiesResponse>("/cms/access/capabilities");
      setData(res);
      const next: Record<string, Set<string>> = {};
      for (const r of res.roles) next[r.name] = new Set(r.capabilities);
      setDraft(next);
    } catch (err) {
      toast({
        title: "Failed to load capabilities",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function save(role: RoleRow) {
    const wanted = Array.from(draft[role.name] ?? new Set<string>());
    setSavingRole(role.name);
    try {
      await apiFetch(`/cms/access/roles/${role.name}/capabilities`, {
        method: "PUT",
        body: JSON.stringify({ capabilities: wanted }),
      });
      toast({ title: `Updated ${role.name}` });
      await load();
    } catch (err) {
      toast({
        title: `Failed to update ${role.name}`,
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingRole(null);
    }
  }

  function toggle(roleName: string, capName: string) {
    setDraft((prev) => {
      const next = { ...prev };
      const set = new Set(next[roleName] ?? []);
      if (set.has(capName)) set.delete(capName);
      else set.add(capName);
      next[roleName] = set;
      return next;
    });
  }

  function isDirty(role: RoleRow): boolean {
    const set = draft[role.name];
    if (!set) return false;
    if (set.size !== role.capabilities.length) return true;
    return role.capabilities.some((c) => !set.has(c));
  }

  const sortedRoles = useMemo(() => {
    if (!data) return [];
    // Show audience classes (#110) first, then legacy roles, alphabetical within.
    const audience = new Set([
      "site_admin",
      "content_author",
      "hr",
      "internal",
      "customer",
      "registered",
    ]);
    const lhs = data.roles.filter((r) => audience.has(r.name));
    const rhs = data.roles.filter((r) => !audience.has(r.name));
    return [...lhs, ...rhs];
  }, [data]);

  return (
    <AdminLayout
      title="Roles & Capabilities"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Access" }, { label: "Capabilities" }]}
    >
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : !data ? (
        <Card className="p-12 text-center text-muted-foreground">No data.</Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Toggle which capabilities each role grants. Changes apply immediately
            to new sign-ins; signed-in users pick up the new map on their next
            <code className="px-1 mx-1 text-xs bg-muted rounded">/api/auth/me</code>
            refresh.
          </p>
          {sortedRoles.map((role) => {
            const dirty = isDirty(role);
            const saving = savingRole === role.name;
            return (
              <Card
                key={role.id}
                className="p-4 flex items-start gap-4 flex-wrap"
                data-testid={`role-row-${role.name}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-2">
                    {role.name}
                    {role.description && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {role.description}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {data.capabilities.map((cap) => {
                    const active = draft[role.name]?.has(cap.name) ?? false;
                    return (
                      <button
                        key={cap.id}
                        onClick={() => toggle(role.name, cap.name)}
                        title={cap.description ?? cap.name}
                        className={`text-xs px-2.5 py-1 rounded-full border ${active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                        data-testid={`cap-${role.name}-${cap.name}`}
                      >
                        {cap.name}
                      </button>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  disabled={!dirty || saving}
                  onClick={() => save(role)}
                  data-testid={`save-role-${role.name}`}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}
