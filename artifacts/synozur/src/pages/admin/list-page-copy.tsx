import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { api, type ContentParentPageDto } from "@/lib/api";

interface Draft {
  id: string;
  slug: string;
  heroEyebrow: string;
  heroHeadline: string;
  heroSubhead: string;
  introHtml: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  active: boolean;
}

function toDraft(p: ContentParentPageDto): Draft {
  return {
    id: p.id,
    slug: p.slug,
    heroEyebrow: p.heroEyebrow ?? "",
    heroHeadline: p.heroHeadline ?? "",
    heroSubhead: p.heroSubhead ?? "",
    introHtml: p.introHtml ?? "",
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    ogImage: p.ogImage ?? "",
    active: p.active,
  };
}

export default function AdminListPageCopy() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const canWrite = !!access?.isEditorOrAbove;

  const listQ = useQuery({
    queryKey: ["admin-parent-pages"],
    queryFn: () => api.adminListParentPages(),
  });

  const [editing, setEditing] = useState<Draft | null>(null);

  const pages = listQ.data?.items ?? [];

  return (
    <AdminLayout
      title="List page copy"
      crumbs={[{ label: "Admin", href: "/" }, { label: "List page copy" }]}
    >
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        Hero headline, intro copy, and SEO tags for each resource list page.
        Empty fields fall back to the hardcoded defaults in the page
        component, so you can safely clear a field to revert.
      </p>

      {listQ.isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Hero headline</TableHead>
                <TableHead>SEO title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No rows yet. Run seedContentParentPages to populate defaults.
                  </TableCell>
                </TableRow>
              )}
              {pages.map((p) => (
                <TableRow key={p.id} data-testid={`parent-page-row-${p.slug}`}>
                  <TableCell className="font-medium">
                    /{p.slug}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {p.heroHeadline || <span className="italic">(default)</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {p.seoTitle || <span className="italic">(default)</span>}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        "text-xs uppercase tracking-wide px-2 py-1 rounded " +
                        (p.active ? "bg-primary/10 text-primary" : "bg-muted")
                      }
                    >
                      {p.active ? "Active" : "Hidden"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(toDraft(p))}
                      disabled={!canWrite}
                      data-testid={`parent-page-edit-${p.slug}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EditDialog
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          toast({ title: "Saved" });
          qc.invalidateQueries({ queryKey: ["admin-parent-pages"] });
          qc.invalidateQueries({ queryKey: ["parent-page"] });
          setEditing(null);
        }}
      />
    </AdminLayout>
  );
}

function EditDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<Draft | null>(draft);

  useEffect(() => {
    setLocal(draft);
  }, [draft]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.adminUpdateParentPage(local!.id, {
        heroEyebrow: local!.heroEyebrow || null,
        heroHeadline: local!.heroHeadline || null,
        heroSubhead: local!.heroSubhead || null,
        introHtml: local!.introHtml || null,
        seoTitle: local!.seoTitle || null,
        seoDescription: local!.seoDescription || null,
        ogImage: local!.ogImage || null,
        active: local!.active,
      }),
    onSuccess: onSaved,
  });

  if (!local) return null;

  return (
    <Dialog open={!!draft} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit /{local.slug}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="pp-eyebrow">Eyebrow</Label>
            <Input
              id="pp-eyebrow"
              placeholder="e.g. White Papers & eBooks"
              value={local.heroEyebrow}
              onChange={(e) => setLocal({ ...local, heroEyebrow: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-headline">Hero headline</Label>
            <Input
              id="pp-headline"
              value={local.heroHeadline}
              onChange={(e) => setLocal({ ...local, heroHeadline: e.target.value })}
              data-testid="parent-page-headline"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-subhead">Hero subhead</Label>
            <Textarea
              id="pp-subhead"
              rows={3}
              value={local.heroSubhead}
              onChange={(e) => setLocal({ ...local, heroSubhead: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-intro">Intro HTML</Label>
            <Textarea
              id="pp-intro"
              rows={4}
              value={local.introHtml}
              onChange={(e) => setLocal({ ...local, introHtml: e.target.value })}
              placeholder="Optional longer intro paragraph (supports HTML)."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pp-seo-title">SEO title</Label>
              <Input
                id="pp-seo-title"
                value={local.seoTitle}
                onChange={(e) => setLocal({ ...local, seoTitle: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-og">OG image URL</Label>
              <Input
                id="pp-og"
                value={local.ogImage}
                onChange={(e) => setLocal({ ...local, ogImage: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-seo-desc">SEO description</Label>
            <Textarea
              id="pp-seo-desc"
              rows={2}
              value={local.seoDescription}
              onChange={(e) => setLocal({ ...local, seoDescription: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Switch
              checked={local.active}
              onCheckedChange={(v) => setLocal({ ...local, active: v })}
            />
            <Label>Active (publish overrides)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="parent-page-save"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
