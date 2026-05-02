import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useListCmsUsers,
  useSetCmsUserRoles,
  type CmsUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// #110 — surface all eleven assignable roles. The generated `RoleName`
// enum from api-zod is still on the legacy 4; rather than block on a
// codegen pass, source the canonical list locally. The server validates
// against the same list via z.enum(ROLE_NAMES).
const ALL_ROLES = [
  "site_admin",
  "admin",
  "editor",
  "content_author",
  "author",
  "contributor",
  "hr",
  "internal",
  "customer",
  "client",
  "registered",
] as const;
type AssignableRole = (typeof ALL_ROLES)[number];

// `local` covers email/password registrants (no `auth_provider` set, or set to
// the local-registration discriminator); `unknown` catches anything else so
// admins notice an unexpected provider value rather than seeing it silently
// hidden by the filter.
const PROVIDER_FILTERS = ["all", "entra", "imported", "local", "unknown"] as const;
type ProviderFilter = (typeof PROVIDER_FILTERS)[number];

function classifyProvider(authProvider: string | null | undefined): Exclude<ProviderFilter, "all"> {
  if (!authProvider) return "local";
  if (authProvider === "entra") return "entra";
  if (authProvider === "imported") return "imported";
  if (authProvider === "local" || authProvider === "password") return "local";
  return "unknown";
}

const PROVIDER_LABEL: Record<Exclude<ProviderFilter, "all">, string> = {
  entra: "Entra",
  imported: "Imported (placeholder)",
  local: "Local password",
  unknown: "Other",
};

export default function UsersAndRoles() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useListCmsUsers();
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const set = useSetCmsUserRoles({
    mutation: {
      onSuccess: () => {
        toast({ title: "Roles updated" });
        refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Update failed", description: e.message, variant: "destructive" }),
    },
  });

  const filtered = useMemo(() => {
    const all = data ?? [];
    if (providerFilter === "all") return all;
    return all.filter((u) => classifyProvider(u.authProvider) === providerFilter);
  }, [data, providerFilter]);

  const counts = useMemo(() => {
    const acc: Record<Exclude<ProviderFilter, "all">, number> = {
      entra: 0,
      imported: 0,
      local: 0,
      unknown: 0,
    };
    for (const u of data ?? []) acc[classifyProvider(u.authProvider)]++;
    return acc;
  }, [data]);

  return (
    <AdminLayout
      title="Users & Roles"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Users" }]}
    >
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <label className="text-sm text-muted-foreground" htmlFor="provider-filter">
          Provider
        </label>
        <Select
          value={providerFilter}
          onValueChange={(v) => setProviderFilter(v as ProviderFilter)}
        >
          <SelectTrigger id="provider-filter" className="w-[220px]" data-testid="provider-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({(data ?? []).length})</SelectItem>
            <SelectItem value="entra">{PROVIDER_LABEL.entra} ({counts.entra})</SelectItem>
            <SelectItem value="imported">{PROVIDER_LABEL.imported} ({counts.imported})</SelectItem>
            <SelectItem value="local">{PROVIDER_LABEL.local} ({counts.local})</SelectItem>
            <SelectItem value="unknown">{PROVIDER_LABEL.unknown} ({counts.unknown})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data ?? []).length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No users yet.</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No users match this provider filter.
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((u: CmsUser) => (
            <UserRow
              key={u.id}
              user={u}
              onSave={(roles) =>
                set.mutate({
                  id: u.id,
                  // The generated body type still wants the legacy RoleName enum,
                  // so widen via a deliberate cast at the boundary. Server-side
                  // z.enum(ROLE_NAMES) is the actual authority.
                  data: { roles: roles as unknown as CmsUser["roles"] },
                })
              }
              pending={set.isPending}
            />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

function UserRow({
  user,
  onSave,
  pending,
}: {
  user: CmsUser;
  onSave: (roles: AssignableRole[]) => void;
  pending: boolean;
}) {
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles));
  const dirty =
    roles.size !== user.roles.length || user.roles.some((r) => !roles.has(r));

  return (
    <Card className="p-4 flex items-center gap-4 flex-wrap" data-testid={`user-row-${user.id}`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{user.displayName ?? user.email ?? user.externalSubject ?? user.id}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{user.email}</span>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {PROVIDER_LABEL[classifyProvider(user.authProvider)]}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {ALL_ROLES.map((r) => {
          const active = roles.has(r);
          return (
            <button
              key={r}
              onClick={() => {
                const s = new Set(roles);
                if (active) s.delete(r);
                else s.add(r);
                setRoles(s);
              }}
              className={`text-xs px-2.5 py-1 rounded-full border ${active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              data-testid={`role-${user.id}-${r}`}
            >
              {r}
            </button>
          );
        })}
      </div>
      {user.roles.length > 0 && !dirty && (
        <div className="flex items-center gap-1">
          {user.roles.map((r) => (
            <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
          ))}
        </div>
      )}
      <Button
        size="sm"
        disabled={!dirty || pending}
        onClick={() => onSave(Array.from(roles) as AssignableRole[])}
        data-testid={`save-roles-${user.id}`}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </Card>
  );
}
