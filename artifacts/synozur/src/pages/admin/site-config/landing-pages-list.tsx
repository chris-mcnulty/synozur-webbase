import { AppLink } from "@/components/ui/app-link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  landingPagesApi,
  type LandingPageDto,
} from "@/lib/api-landing-pages";

const LIST_KEY = ["admin-landing-pages"];

export default function AdminLandingPagesList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => landingPagesApi.listAdmin(),
  });
  const items: LandingPageDto[] = listQ.data?.items ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => landingPagesApi.remove(id),
    onSuccess: () => {
      toast({ title: "Landing page archived" });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const onDelete = (p: LandingPageDto) => {
    if (!canWrite) return;
    if (!confirm(`Archive landing page "${p.title}"? It will stop serving at /${p.slug}.`))
      return;
    deleteMut.mutate(p.id);
  };

  return (
    <AdminLayout
      title="Landing Pages"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Landing Pages" }]}
      actions={
        canWrite && (
          <Button asChild data-testid="button-create-landing-page">
            <AppLink href="/site-config/landing-pages/new" asChild unstyled>
              <Plus className="h-4 w-4 mr-2" /> New landing page
            </AppLink>
          </Button>
        )
      }
    >
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        Standalone, composable landing pages served from the site root (e.g.{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          /ai-training
        </code>
        ). Each page is a typed sequence of blocks — hero, rich text, card grid,
        CTA, image, FAQ — and stays editable without code changes.
      </p>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Blocks</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  No landing pages yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id} data-testid={`row-landing-page-${p.id}`}>
                  <TableCell className="font-medium">
                    <AppLink
                      href={`/site-config/landing-pages/${p.id}/edit`}
                      data-testid={`link-edit-landing-page-${p.id}`}
                    >
                      {p.title}
                    </AppLink>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    /{p.slug}
                    {p.status === "published" && (
                      <a
                        href={`/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 inline-flex items-center text-primary"
                        aria-label="Open page"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        p.status === "published"
                          ? "default"
                          : p.status === "draft"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{p.blocks.length}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button asChild variant="ghost" size="icon">
                        <AppLink
                          href={`/site-config/landing-pages/${p.id}/edit`}
                          asChild
                          unstyled
                        >
                          <Pencil className="h-4 w-4" />
                        </AppLink>
                      </Button>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(p)}
                          data-testid={`button-delete-landing-page-${p.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
