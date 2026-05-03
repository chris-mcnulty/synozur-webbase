import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { api } from "@/lib/api";

export default function AdminTeamList() {
  const qc = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["admin-team-members"],
    queryFn: () => api.adminTeamMembers(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTeamMember(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-team-members"] });
      qc.invalidateQueries({ queryKey: ["public-team-members"] });
    },
  });

  return (
    <AdminLayout
      title="Team"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Team" }]}
      actions={
        <Link href="/people/team-members/new">
          <Button data-testid="button-new-team-member">
            <Plus className="h-4 w-4 mr-2" /> New Member
          </Button>
        </Link>
      }
    >
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Sort</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No team members yet.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => (
                <TableRow key={m.id} data-testid={`row-team-member-${m.id}`}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.jobTitle}</TableCell>
                  <TableCell>
                    <span
                      className={
                        "text-xs uppercase tracking-wide px-2 py-1 rounded " +
                        (m.active ? "bg-primary/10 text-primary" : "bg-muted")
                      }
                    >
                      {m.active ? "Active" : "Hidden"}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.manualSort || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Link href={`/people/team-members/${m.id}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-edit-team-${m.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete team member "${m.name}"? This will remove them from the public site.`)) {
                            deleteMutation.mutate(m.id);
                          }
                        }}
                        data-testid={`button-delete-team-${m.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminLayout>
  );
}
