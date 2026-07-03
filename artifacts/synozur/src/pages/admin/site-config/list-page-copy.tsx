import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Pencil, Save } from "lucide-react";
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
import {
  MediaPickerModal,
  mediaUrl,
} from "@/components/admin/MediaPickerModal";
import { SocialCardPreview } from "@/components/admin/SocialCardPreview";
import type { MediaItem } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { api, type ContentParentPageDto } from "@/lib/api";

/**
 * Hardcoded SEO defaults for each parent page, mirroring what the live page
 * components use when the DB row has no override. Keep this in sync with the
 * page components whenever their defaults change.
 */
const PAGE_DEFAULTS: Record<
  string,
  { title: string; description: string; image?: string }
> = {
  sprint: {
    title: "The AI & North Star Sprint — The Synozur Alliance",
    description:
      "A structured executive engagement that turns ambiguity into aligned decisions, a practical AI-first roadmap, and measurable next steps — in 4 to 6 weeks.",
    image: "/og/og-sprint.jpg",
  },
  proof: {
    title: "Proof — Outcomes We Can Prove — The Synozur Alliance",
    description:
      "Anchor cases in Before / After / Impact form — from a Microsoft engagement to AI transformation in private equity. Measurable outcomes, not promises.",
    image: "/og/og-proof.jpg",
  },
  fit: {
    title: "Is the Sprint Right for You? — The Synozur Alliance",
    description:
      "The AI & North Star Sprint is most effective when leadership teams are ready to align on what matters. See where it creates the most value — and where it may not fit.",
    image: "/og/og-fit.jpg",
  },
  book: {
    title: "Book the Conversation — The Synozur Alliance",
    description:
      "Schedule a focused working conversation to understand your current context, where alignment may be breaking down, and whether the AI & North Star Sprint is the right next step.",
    image: "/og/og-book.jpg",
  },
  "white-papers": {
    title: "White Papers & eBooks",
    description:
      "In-depth white papers, reports, and eBooks from the Synozur team on transformation, AI, and the digital workplace.",
  },
  applications: {
    title: "Applications",
    description:
      "Synozur's portfolio of AI-powered applications — Vega, Nebula, Constellation, Orion, Orbit, Zenith, and more.",
  },
  items: {
    title: "White Papers",
    description:
      "Read Synozur white papers on transformation strategy, technology, AI, experiences, and go-to-market.",
  },
  insights: {
    title: "Insights",
    description:
      "The Feed. Original writing on transformation, technology, leadership, and the operating disciplines that let strategy actually ship.",
  },
  library: {
    title: "Library",
    description:
      "Browse the full Synozur collateral library — white papers, webinars, case studies, podcasts, models, workshops, and more.",
  },
  videos: {
    title: "Videos",
    description:
      "Watch interviews, webinars, and conversations from Synozur leaders and partners.",
  },
  webinars: {
    title: "Webinars",
    description:
      "Watch and revisit Synozur webinars on transformation, AI, the digital workplace, and more.",
  },
  workshops: {
    title: "Workshops",
    description: "",
  },
  "case-studies": {
    title: "Case Studies",
    description:
      "Selected stories of transformation. The strategies, the work, and the outcomes.",
  },
  models: {
    title: "Maturity Models",
    description:
      "AI, KMMM, GTM, Content Management, and Company OS maturity models from The Synozur Alliance.",
  },
  start: {
    title: "Get Started",
    description:
      "Book time with The Synozur Alliance — general intros, offer-specific calendars, and conference windows.",
  },
};

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
        Hero headline, intro copy, and SEO tags for each resource list page —
        plus the Sprint funnel pages (/sprint, /proof, /fit, /book), where the
        SEO title, description, and social share image override what social
        crawlers see. Empty fields fall back to the hardcoded defaults in the
        page component, so you can safely clear a field to revert.
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
  const [ogPickerOpen, setOgPickerOpen] = useState(false);

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
          {(() => {
            const pd = PAGE_DEFAULTS[local.slug];
            return (
              <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Social card preview
                </p>
                <SocialCardPreview
                  title={local.seoTitle}
                  description={local.seoDescription}
                  imageUrl={local.ogImage}
                  defaultTitle={pd?.title}
                  defaultDescription={pd?.description}
                  defaultImageUrl={pd?.image}
                />
              </div>
            );
          })()}
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
              <Label htmlFor="pp-og">Social share image</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pp-og"
                  value={local.ogImage}
                  onChange={(e) => setLocal({ ...local, ogImage: e.target.value })}
                  placeholder="https://…"
                  className="flex-1"
                  data-testid="parent-page-og-image"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setOgPickerOpen(true)}
                  title="Pick from media library"
                  data-testid="parent-page-og-image-pick"
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>
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
      <MediaPickerModal
        open={ogPickerOpen}
        onClose={() => setOgPickerOpen(false)}
        onSelect={(item: MediaItem) => {
          setLocal((d) => (d ? { ...d, ogImage: mediaUrl(item) } : d));
          setOgPickerOpen(false);
        }}
        title="Pick social share image"
        kind="image"
      />
    </Dialog>
  );
}
