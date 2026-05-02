import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ListOrdered, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useCmsUpdateSolution,
  useCmsDeleteSolution,
  cmsListSolutionCapabilities,
  type Service,
  type Solution,
} from "@workspace/api-client-react";

export default function AdminSolutionsList() {
  const search = useSearch();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const serviceFilter = params.get("service") ?? "all";

  const [query, setQuery] = useState("");

  const servicesQ = useCmsListServices();
  const solutionsQ = useCmsListSolutions();

  const services: Service[] = (servicesQ.data?.items ?? []) as Service[];
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const allSolutions: Solution[] = (solutionsQ.data?.items ?? []) as Solution[];
  const filteredByService =
    serviceFilter === "all"
      ? allSolutions
      : allSolutions.filter((s) => s.parentServiceId === serviceFilter);
  const solutions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredByService;
    return filteredByService.filter((s) => {
      const hay = `${s.title ?? ""} ${s.slug ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filteredByService, query]);

  const capabilityQueries = useQueries({
    queries: solutions.map((s) => ({
      queryKey: ["/api/cms/solutions", s.id, "capabilities"],
      queryFn: () => cmsListSolutionCapabilities(s.id),
      enabled: solutions.length > 0,
    })),
  });

  const updateMut = useCmsUpdateSolution({
    mutation: {
      onSuccess: () => {
        toast({ title: "Solution updated" });
        solutionsQ.refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Update failed", description: e.message, variant: "destructive" }),
    },
  });

  const deleteMut = useCmsDeleteSolution({
    mutation: {
      onSuccess: () => {
        toast({ title: "Solution deleted" });
        solutionsQ.refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const setFilter = (v: string) => {
    const next = new URLSearchParams(search);
    if (v === "all") next.delete("service");
    else next.set("service", v);
    const qs = next.toString();
    const url = `/admin/products/solutions${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", url);
    // wouter useSearch reacts to popstate; force reload via location change:
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const toggleActive = (s: Solution, next: boolean) => {
    if (!canWrite) return;
    updateMut.mutate({ id: s.id, data: { title: s.title, active: next } });
  };

  const onDelete = (s: Solution) => {
    if (!canWrite) return;
    if (!confirm(`Archive solution "${s.title}"?`)) return;
    deleteMut.mutate({ id: s.id });
  };

  return (
    <AdminLayout
      title="Solutions"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Solutions" }]}
      actions={
        canWrite && (
          <Link href="/products/solutions/new">
            <Button data-testid="button-create-solution">
              <Plus className="h-4 w-4 mr-2" /> New solution
            </Button>
          </Link>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title or slug…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-solutions-search"
          />
        </div>
        <Select value={serviceFilter} onValueChange={setFilter}>
          <SelectTrigger className="w-[260px]" data-testid="select-solutions-service-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(query || serviceFilter !== "all") && (
          <span className="text-xs text-muted-foreground">
            {solutions.length} of {allSolutions.length} matching
          </span>
        )}
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Parent service</TableHead>
              <TableHead className="w-20 text-right">Order</TableHead>
              <TableHead className="w-28 text-right">Capabilities</TableHead>
              <TableHead>Blog category</TableHead>
              <TableHead className="w-20">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {solutionsQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : solutions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {query || serviceFilter !== "all"
                    ? "No solutions match this filter."
                    : "No solutions yet."}
                </TableCell>
              </TableRow>
            ) : (
              solutions.map((s, i) => {
                const cq = capabilityQueries[i];
                const cCount = cq?.data?.items?.length ?? null;
                const parent = s.parentServiceId
                  ? serviceById.get(s.parentServiceId)
                  : undefined;
                return (
                  <TableRow key={s.id} data-testid={`row-solution-${s.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/products/solutions/${s.id}/edit`}>
                        <a className="hover:underline">{s.title}</a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      /{s.slug}
                    </TableCell>
                    <TableCell className="text-sm">{parent?.title ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      {s.displayOrder ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Link href={`/products/solutions/${s.id}/capabilities`}>
                        <a
                          className="hover:underline"
                          data-testid={`link-capabilities-${s.id}`}
                        >
                          {cCount ?? "…"}
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.blogCategory ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.active}
                        onCheckedChange={(v) => toggleActive(s, v)}
                        disabled={!canWrite}
                        data-testid={`switch-solution-active-${s.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Link href={`/products/solutions/${s.id}/capabilities`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-manage-capabilities-${s.id}`}
                          >
                            <ListOrdered className="h-4 w-4 mr-1" /> Capabilities
                          </Button>
                        </Link>
                        <Link href={`/products/solutions/${s.id}/edit`}>
                          <Button variant="ghost" size="icon">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(s)}
                            data-testid={`button-delete-solution-${s.id}`}
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
