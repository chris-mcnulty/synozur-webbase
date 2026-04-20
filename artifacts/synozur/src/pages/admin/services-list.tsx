import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ListOrdered, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";
import {
  useCmsListServices,
  useCmsListSolutions,
  useCmsUpdateService,
  useCmsDeleteService,
  cmsListServiceMethodologies,
  type Service,
} from "@workspace/api-client-react";

export default function AdminServicesList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const servicesQ = useCmsListServices();
  const solutionsQ = useCmsListSolutions();

  const services: Service[] = (servicesQ.data?.items ?? []) as Service[];
  const solutionCounts = new Map<string, number>();
  for (const s of solutionsQ.data?.items ?? []) {
    if (!s.parentServiceId) continue;
    solutionCounts.set(s.parentServiceId, (solutionCounts.get(s.parentServiceId) ?? 0) + 1);
  }

  const methodologyQueries = useQueries({
    queries: services.map((s) => ({
      queryKey: ["/api/cms/services", s.id, "methodologies"],
      queryFn: () => cmsListServiceMethodologies(s.id),
      enabled: services.length > 0,
    })),
  });

  const updateMut = useCmsUpdateService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service updated" });
        servicesQ.refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Update failed", description: e.message, variant: "destructive" }),
    },
  });

  const deleteMut = useCmsDeleteService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service deleted" });
        servicesQ.refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const toggleActive = (s: Service, next: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: s.id, data: { title: s.title, active: next } });
  };

  const onDelete = (s: Service) => {
    if (!canWrite) return;
    if (!confirm(`Archive service "${s.title}"?`)) return;
    deleteMut.mutate({ id: s.id });
  };

  return (
    <AdminLayout
      title="Services"
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Services" }]}
      actions={
        canWrite && (
          <Link href="/admin/services/new">
            <Button data-testid="button-create-service">
              <Plus className="h-4 w-4 mr-2" /> New service
            </Button>
          </Link>
        )
      }
    >
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="w-20 text-right">Order</TableHead>
              <TableHead className="w-24 text-right">Solutions</TableHead>
              <TableHead className="w-28 text-right">Methodologies</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servicesQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : services.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No services yet.
                </TableCell>
              </TableRow>
            ) : (
              services.map((s, i) => {
                const mq = methodologyQueries[i];
                const mCount = mq?.data?.items?.length ?? null;
                return (
                  <TableRow key={s.id} data-testid={`row-service-${s.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/admin/services/${s.id}/edit`}>
                        <a className="hover:underline" data-testid={`link-edit-service-${s.id}`}>
                          {s.title}
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      /{s.slug}
                    </TableCell>
                    <TableCell className="text-right text-sm">{s.displayOrder ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      <Link href={`/admin/solutions?service=${s.id}`}>
                        <a className="hover:underline" data-testid={`link-solutions-${s.id}`}>
                          {solutionCounts.get(s.id) ?? 0}
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Link href={`/admin/services/${s.id}/methodologies`}>
                        <a
                          className="hover:underline"
                          data-testid={`link-methodologies-${s.id}`}
                        >
                          {mCount ?? "…"}
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.active}
                        onCheckedChange={(v) => toggleActive(s, v)}
                        disabled={!canWrite}
                        data-testid={`switch-active-${s.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Link href={`/admin/services/${s.id}/methodologies`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-manage-methodologies-${s.id}`}
                          >
                            <ListOrdered className="h-4 w-4 mr-1" /> Methodologies
                          </Button>
                        </Link>
                        <Link href={`/admin/solutions?service=${s.id}`}>
                          <Button variant="ghost" size="sm">
                            <Layers className="h-4 w-4 mr-1" /> Solutions
                          </Button>
                        </Link>
                        <Link href={`/admin/services/${s.id}/edit`}>
                          <Button variant="ghost" size="icon">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(s)}
                            data-testid={`button-delete-service-${s.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
