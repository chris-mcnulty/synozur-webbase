import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppLink } from "@/components/ui/app-link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ExternalLink, Upload, Star } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";
import {
  landingPagesApi,
  LandingPageImportConflictError,
  type LandingPageDto,
  type LandingPageExport,
} from "@/lib/api-landing-pages";

const LIST_KEY = ["admin-landing-pages"];

// Pending import that needs a confirmation step because the slug already
// exists in this environment. We keep the parsed payload around so the
// confirm dialog can resubmit with force: true without re-reading the file.
interface PendingImportConflict {
  payload: LandingPageExport;
  existing: LandingPageDto;
}

export default function AdminLandingPagesList() {
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
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

  // ---------------------------------------------------------------------------
  // Import flow
  // ---------------------------------------------------------------------------

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingImportConflict | null>(
    null,
  );

  const sendImport = async (payload: LandingPageExport, force: boolean) => {
    try {
      const result = await landingPagesApi.importPage(payload, { force });
      toast({
        title: result.mode === "created" ? "Imported" : "Updated",
        description: `/${result.page.slug}`,
      });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: ["landing-page", result.page.slug] });
      setPendingConflict(null);
      // Drop the operator straight into the editor so they can verify the
      // result without having to hunt the row down in the list.
      setLocation(`/site-config/landing-pages/${result.page.id}/edit`);
    } catch (err) {
      if (err instanceof LandingPageImportConflictError) {
        setPendingConflict({ payload, existing: err.existing });
        return;
      }
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const onFileChosen = async (file: File) => {
    let parsed: LandingPageExport;
    try {
      const text = await file.text();
      parsed = JSON.parse(text) as LandingPageExport;
    } catch {
      toast({
        title: "Import failed",
        description: "File is not valid JSON.",
        variant: "destructive",
      });
      return;
    }
    if (parsed?.format !== "synozur-landing-page" || parsed?.version !== 1) {
      toast({
        title: "Import failed",
        description:
          "Not a recognised landing-page export (expected format: synozur-landing-page, version: 1).",
        variant: "destructive",
      });
      return;
    }
    await sendImport(parsed, false);
  };

  return (
    <AdminLayout
      title="Landing Pages"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Landing Pages" }]}
      actions={
        canWrite && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset so the same file can be picked twice in a row.
                e.target.value = "";
                if (file) void onFileChosen(file);
              }}
              data-testid="input-import-landing-page"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-import-landing-page"
            >
              <Upload className="h-4 w-4 mr-2" /> Import
            </Button>
            <Button asChild data-testid="button-create-landing-page">
              <AppLink href="/site-config/landing-pages/new" asChild unstyled>
                <Plus className="h-4 w-4 mr-2" /> New landing page
              </AppLink>
            </Button>
          </div>
        )
      }
    >
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        Standalone, composable landing pages served from the site root (e.g.{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          /ai-training
        </code>
        ). Each page is a typed sequence of blocks — hero, rich text, card grid,
        CTA, image, FAQ — and stays editable without code changes. Use{" "}
        <strong>Export</strong> (from the editor) and <strong>Import</strong>{" "}
        (here) to move a page between environments without a full database
        replacement.
      </p>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Pillar</TableHead>
              <TableHead>Blocks</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
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
                  <TableCell>
                    {p.featured ? (
                      <span
                        className="inline-flex items-center gap-1 text-amber-500"
                        title={
                          p.featuredRank != null
                            ? `Rank ${p.featuredRank}`
                            : "Featured"
                        }
                      >
                        <Star className="h-3.5 w-3.5 fill-current" />
                        {p.featuredRank != null && (
                          <span className="text-xs tabular-nums">
                            {p.featuredRank}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.pillar ? (
                      <span className="capitalize">{p.pillar}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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

      <Dialog
        open={!!pendingConflict}
        onOpenChange={(o) => (!o ? setPendingConflict(null) : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overwrite existing landing page?</DialogTitle>
            <DialogDescription>
              A landing page with slug{" "}
              <code className="font-mono">/{pendingConflict?.existing.slug}</code>{" "}
              already exists in this environment (status:{" "}
              <strong>{pendingConflict?.existing.status}</strong>, last updated{" "}
              {pendingConflict
                ? new Date(pendingConflict.existing.updatedAt).toLocaleString()
                : ""}
              ). Importing will replace its title, status, blocks, and SEO
              fields with the values from the uploaded file. The page id and
              first-publish timestamp are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingConflict(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingConflict) {
                  void sendImport(pendingConflict.payload, true);
                }
              }}
              data-testid="button-confirm-import-overwrite"
            >
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

