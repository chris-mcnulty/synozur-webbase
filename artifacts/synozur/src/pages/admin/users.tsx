import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useListCmsUsers,
  useSetCmsUserRoles,
  RoleName,
  type CmsUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const ALL_ROLES = [RoleName.admin, RoleName.editor, RoleName.author, RoleName.contributor] as const;

export default function UsersAndRoles() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useListCmsUsers();
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

  return (
    <AdminLayout
      title="Users & Roles"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Users" }]}
    >
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data ?? []).length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No users yet.</Card>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((u: CmsUser) => (
            <UserRow key={u.id} user={u} onSave={(roles) => set.mutate({ id: u.id, data: { roles } })} pending={set.isPending} />
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
  onSave: (roles: typeof ALL_ROLES[number][]) => void;
  pending: boolean;
}) {
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles));
  const dirty =
    roles.size !== user.roles.length || user.roles.some((r) => !roles.has(r));

  return (
    <Card className="p-4 flex items-center gap-4 flex-wrap" data-testid={`user-row-${user.id}`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{user.displayName ?? user.email ?? user.clerkUserId}</div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
      </div>
      <div className="flex items-center gap-2">
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
        onClick={() => onSave(Array.from(roles) as typeof ALL_ROLES[number][])}
        data-testid={`save-roles-${user.id}`}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </Card>
  );
}
