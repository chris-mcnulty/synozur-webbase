import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ListOrdered, Layers, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const [search, setSearch] = useState("");

  const servicesQ = useCmsListServices();
  const solutionsQ = useCmsListSolutions();

  const allServices: Service[] = (servicesQ.data?.items ?? []) as Service[];
  const services = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allServices;
    return allServices.filter((s) => {
      const hay = `${s.title ?? ""} ${s.slug ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allServices, search]);

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
    if (!confirm(`Archive service "${s.title}"? This will remove it from the public site.`)) return;
    deleteMut.mutate({ id: s.id });
  };

  return (
    <AdminLayout
      title="Services"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Services" }]}
      actions={
        canWrite && (
          <Link href="/products/services/new">
            <Button data-testid="button-create-service">
              <Plus className="h-4 w-4 mr-2" /> New service
            </Button>
          </Link>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-services-search"
          />
        </div>
        {search && (
          <span className="text-xs text-muted-foreground">
            {services.length} of {allServices.length} matching
          </span>
        )}
      </div>

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
                  {search ? "No services match this search." : "No services yet."}
                </TableCell>
              </TableRow>
            ) : (
              services.map((s, i) => {
                const mq = methodologyQueries[i];
                const mCount = mq?.data?.items?.length ?? null;
                return (
                  <TableRow key={s.id} data-testid={`row-service-${s.id}`}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/products/services/${s.id}/edit`}
                        className="hover:underline"
                        data-testid={`link-edit-service-${s.id}`}
                      >
                        {s.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      /{s.slug}
                    </TableCell>
                    <TableCell className="text-right text-sm">{s.displayOrder ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      <Link
                        href={`/solutions?service=${s.id}`}
                        className="hover:underline"
                        data-testid={`link-solutions-${s.id}`}
                      >
                        {solutionCounts.get(s.id) ?? 0}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Link
                        href={`/products/services/${s.id}/methodologies`}
                        className="hover:underline"
                        data-testid={`link-methodologies-${s.id}`}
                      >
                        {mCount ?? "…"}
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
                        <Link href={`/products/services/${s.id}/methodologies`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-manage-methodologies-${s.id}`}
                          >
                            <ListOrdered className="h-4 w-4 mr-1" /> Methodologies
                          </Button>
                        </Link>
                        <Link href={`/solutions?service=${s.id}`}>
                          <Button variant="ghost" size="sm">
                            <Layers className="h-4 w-4 mr-1" /> Solutions
                          </Button>
                        </Link>
                        <Link href={`/products/services/${s.id}/edit`}>
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
