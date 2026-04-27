import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  X,
  Image as ImageIcon,
  RefreshCw,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { TaxonomyPicker } from "@/components/admin/TaxonomyPicker";
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import type { MediaItem } from "@workspace/api-client-react";
import {
  api,
  WHITE_PAPER_DOC_TYPES,
  WHITE_PAPER_STATUSES,
  type WhitePaperDto,
  type WhitePaperInput,
  type WhitePaperDocType,
  type WhitePaperStatus,
  type WhitePaperDocumentAsset,
} from "@/lib/api";
import { fileExtensionLabel, formatBytes } from "@/lib/asset-kind";

interface Props {
  id?: string;
}

const DOC_TYPE_LABELS: Record<WhitePaperDocType, string> = {
  whitepaper: "White Paper",
  ebook: "eBook",
  report: "Report",
  guide: "Guide",
};

const STATUS_LABELS: Record<WhitePaperStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const PILLAR_OPTIONS: { value: string; label: string }[] = [
  { value: "strategic", label: "Strategic Transformation" },
  { value: "technology", label: "Technology Transformation" },
  { value: "experiences", label: "Experiences" },
  { value: "gtm", label: "Go-to-Market" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

interface FormState {
  title: string;
  slug: string;
  subtitle: string;
  docType: WhitePaperDocType;
  heroImage: string;
  heroImageAlt: string;
  shortDescription: string;
  bodyHtml: string;
  tagsText: string;
  pillar: string;
  documentUrl: string;
  documentAssetId: number | null;
  documentMediaId: string | null;
  documentAsset: WhitePaperDocumentAsset | null;
  externalUrl: string;
  pageCount: string;
  status: WhitePaperStatus;
  publishedAt: string;
  unpublishedAt: string;
  featured: boolean;
  featuredRank: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  active: boolean;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  subtitle: "",
  docType: "whitepaper",
  heroImage: "",
  heroImageAlt: "",
  shortDescription: "",
  bodyHtml: "",
  tagsText: "",
  pillar: "",
  documentUrl: "",
  documentAssetId: null,
  documentMediaId: null,
  documentAsset: null,
  externalUrl: "",
  pageCount: "",
  status: "draft",
  publishedAt: "",
  unpublishedAt: "",
  featured: false,
  featuredRank: "",
  seoTitle: "",
  seoDescription: "",
  ogImage: "",
  active: true,
};

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromItem(item: WhitePaperDto): FormState {
  // When an uploaded document is attached, `documentUrl` in the DTO is the derived
  // storage URL for the asset. Don't echo that back into the "external document"
  // text input — keep it empty so editors see the uploaded asset as primary.
  const rawExternalDocumentUrl = item.documentAsset ? "" : item.documentUrl ?? "";
  return {
    title: item.title,
    slug: item.slug,
    subtitle: item.subtitle ?? "",
    docType: item.docType,
    heroImage: item.heroImage ?? "",
    heroImageAlt: item.heroImageAlt ?? "",
    shortDescription: item.shortDescription ?? "",
    bodyHtml: item.bodyHtml ?? "",
    tagsText: (item.tags ?? []).join(", "),
    pillar: item.pillar ?? "",
    documentUrl: rawExternalDocumentUrl,
    documentAssetId: item.documentAssetId,
    documentMediaId: item.documentMediaId,
    documentAsset: item.documentAsset,
    externalUrl: item.externalUrl ?? "",
    pageCount: item.pageCount == null ? "" : String(item.pageCount),
    status: item.status,
    publishedAt: toDateInput(item.publishedAt),
    unpublishedAt: toDateInput(item.unpublishedAt),
    featured: item.featured,
    featuredRank: item.featuredRank == null ? "" : String(item.featuredRank),
    seoTitle: item.seoTitle ?? "",
    seoDescription: item.seoDescription ?? "",
    ogImage: item.ogImage ?? "",
    active: item.active,
  };
}

function toBody(f: FormState): WhitePaperInput {
  const tags = f.tagsText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    title: f.title,
    slug: f.slug || null,
    subtitle: f.subtitle || null,
    docType: f.docType,
    heroImage: f.heroImage ?? "",
    heroImageAlt: f.heroImageAlt || null,
    shortDescription: f.shortDescription ?? "",
    bodyHtml: f.bodyHtml ?? "",
    tags,
    pillar: f.pillar || null,
    documentUrl: f.documentUrl || null,
    documentAssetId: f.documentAssetId,
    documentMediaId: f.documentMediaId,
    externalUrl: f.externalUrl || null,
    pageCount: f.pageCount === "" ? null : Number(f.pageCount),
    status: f.status,
    publishedAt: f.publishedAt || null,
    unpublishedAt: f.unpublishedAt || null,
    featured: f.featured,
    featuredRank: f.featuredRank === "" ? null : Number(f.featuredRank),
    seoTitle: f.seoTitle || null,
    seoDescription: f.seoDescription || null,
    ogImage: f.ogImage || null,
    active: f.active,
  };
}

export default function WhitePaperEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const itemQ = useQuery({
    queryKey: ["admin-white-paper", id],
    queryFn: () => api.adminGetWhitePaper(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [showDocumentPicker, setShowDocumentPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    if (itemQ.data && !loaded) {
      setForm(fromItem(itemQ.data));
      setSlugTouched(true);
      setLoaded(true);
    }
  }, [itemQ.data, loaded]);

  useEffect(() => {
    if (!slugTouched && form.title) {
      setForm((f) => ({ ...f, slug: slugify(f.title) }));
    }
  }, [form.title, slugTouched]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-white-papers"] });
    qc.invalidateQueries({ queryKey: ["admin-white-paper", id] });
    qc.invalidateQueries({ queryKey: ["public-white-papers"] });
    qc.invalidateQueries({ queryKey: ["/api/cms/collateral"] });
    qc.invalidateQueries({ queryKey: ["collateral"] });
  };

  const createMut = useMutation({
    mutationFn: (body: WhitePaperInput) => api.createWhitePaper(body),
    onSuccess: (created) => {
      toast({ title: "White paper created" });
      invalidate();
      navigate(`/library/white-papers/${created.id}/edit`);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: WhitePaperInput) => api.updateWhitePaper(id!, body),
    onSuccess: () => {
      toast({ title: "White paper saved" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const syncMut = useMutation({
    mutationFn: () => api.syncWhitePaperToCollateral(id!),
    onSuccess: () => {
      invalidate();
      setSyncStatus("Synced to library.");
    },
    onError: (e: Error) => setSyncStatus(`Sync failed: ${e.message}`),
  });

  const onSave = () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const body = toBody(form);
    if (id) updateMut.mutate(body);
    else createMut.mutate(body);
  };

  const handleHero = (m: MediaItem) => {
    update({ heroImage: mediaUrl(m) });
    setShowHeroPicker(false);
  };

  const handleDocument = (m: MediaItem) => {
    // Store the new UUID in `documentMediaId` and clear the legacy integer
    // `documentAssetId` so the server consults the unified media table on
    // read. The local `documentAsset` shape is reused to drive the existing
    // file-card UI; the `id: -1` sentinel signals a media-backed row.
    update({
      documentAssetId: null,
      documentMediaId: m.id,
      documentAsset: {
        id: -1,
        originalName: m.originalName ?? m.altText ?? m.storageKey,
        mimeType: m.mime ?? "application/octet-stream",
        size: m.byteSize ?? 0,
        storageKey: m.storageKey,
      },
      documentUrl: "",
    });
    setShowDocumentPicker(false);
  };

  if (!isNew && itemQ.isLoading && !loaded) {
    return (
      <AdminLayout title="Edit White Paper">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New White Paper" : `Edit: ${itemQ.data?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "White Papers", href: "/library/white-papers" },
        { label: isNew ? "New" : itemQ.data?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/library/white-papers")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-white-paper"
            >
              <Save className="h-4 w-4 mr-1" />
              {createMut.isPending || updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      }
    >
      {!canWrite && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          You have read-only access. Only editors and admins can change white papers.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4 min-w-0">
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                disabled={!canWrite}
                data-testid="input-white-paper-title"
                className="text-xl font-semibold h-11"
              />
            </div>
            <div>
              <Label htmlFor="subtitle">Subtitle</Label>
              <Input
                id="subtitle"
                value={form.subtitle}
                onChange={(e) => update({ subtitle: e.target.value })}
                disabled={!canWrite}
                placeholder="e.g., A Synozur Report"
                data-testid="input-white-paper-subtitle"
              />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/white-papers/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-white-paper-slug"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="docType">Document type</Label>
                <Select
                  value={form.docType}
                  onValueChange={(v) => update({ docType: v as WhitePaperDocType })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="docType" data-testid="select-white-paper-doc-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WHITE_PAPER_DOC_TYPES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {DOC_TYPE_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pillar">Pillar</Label>
                <Select
                  value={form.pillar || "__none__"}
                  onValueChange={(v) => update({ pillar: v === "__none__" ? "" : v })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="pillar" data-testid="select-white-paper-pillar">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {PILLAR_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="shortDescription">Short description</Label>
              <Textarea
                id="shortDescription"
                value={form.shortDescription}
                onChange={(e) => update({ shortDescription: e.target.value })}
                disabled={!canWrite}
                rows={3}
                placeholder="One- or two-sentence summary used on cards and list pages."
                data-testid="input-white-paper-short-description"
              />
            </div>
            <div>
              <Label htmlFor="bodyHtml">Item page body (HTML)</Label>
              <Textarea
                id="bodyHtml"
                value={form.bodyHtml}
                onChange={(e) => update({ bodyHtml: e.target.value })}
                disabled={!canWrite}
                rows={12}
                className="font-mono text-sm"
                placeholder="<p>Full description, what's inside, chapter summaries, etc.</p>"
                data-testid="input-white-paper-body-html"
              />
            </div>
            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={form.tagsText}
                onChange={(e) => update({ tagsText: e.target.value })}
                disabled={!canWrite}
                placeholder="AI, governance, copilot"
                data-testid="input-white-paper-tags"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Download links
            </h3>
            <div className="space-y-2">
              <Label>Uploaded Document</Label>
              {(form.documentAssetId || form.documentMediaId) && !form.documentAsset ? (
                <div
                  className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
                  data-testid="white-paper-document-broken"
                >
                  <FileText className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-destructive">
                      Attached document not found
                    </div>
                    <div className="text-xs text-muted-foreground">
                      The previously attached document could not be loaded. Clear it to use an external URL.
                    </div>
                  </div>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update({
                          documentAssetId: null,
                          documentMediaId: null,
                          documentAsset: null,
                        })
                      }
                      data-testid="button-clear-broken-white-paper-document"
                    >
                      <X className="h-4 w-4 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              ) : form.documentAsset ? (
                <div
                  className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3"
                  data-testid="white-paper-document-asset"
                >
                  <FileText className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium" title={form.documentAsset.originalName}>
                      {form.documentAsset.originalName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fileExtensionLabel(form.documentAsset)} · {formatBytes(form.documentAsset.size)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowDocumentPicker(true)}
                        data-testid="button-change-white-paper-document"
                      >
                        Change
                      </Button>
                    )}
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                        update({
                          documentAssetId: null,
                          documentMediaId: null,
                          documentAsset: null,
                        })
                      }
                        data-testid="button-remove-white-paper-document"
                      >
                        <X className="h-4 w-4 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                canWrite && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowDocumentPicker(true)}
                    data-testid="button-pick-white-paper-document"
                  >
                    <FileText className="h-4 w-4 mr-1" /> Upload or Choose Document
                  </Button>
                )
              )}
              <p className="text-xs text-muted-foreground">
                Takes precedence over the external URL below. The public download
                CTA will serve the uploaded file via <code>/api/storage</code>.
              </p>
            </div>
            <div>
              <Label htmlFor="documentUrl">External Document URL (fallback)</Label>
              <Input
                id="documentUrl"
                value={form.documentUrl}
                onChange={(e) => update({ documentUrl: e.target.value })}
                disabled={!canWrite || !!form.documentAsset}
                placeholder="https://.../whitepaper.pdf"
                data-testid="input-white-paper-document-url"
              />
              {form.documentAsset && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Disabled while an uploaded document is attached.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="externalUrl">External URL (e.g., Sway, microsite)</Label>
              <Input
                id="externalUrl"
                value={form.externalUrl}
                onChange={(e) => update({ externalUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="https://sway.cloud.microsoft/..."
                data-testid="input-white-paper-external-url"
              />
            </div>
            <div>
              <Label htmlFor="pageCount">Page count (optional)</Label>
              <Input
                id="pageCount"
                type="number"
                value={form.pageCount}
                onChange={(e) => update({ pageCount: e.target.value })}
                disabled={!canWrite}
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              SEO &amp; publishing
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => update({ status: v as WhitePaperStatus })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="status" data-testid="select-white-paper-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WHITE_PAPER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="publishedAt">Publish date</Label>
                <Input
                  id="publishedAt"
                  type="date"
                  value={form.publishedAt}
                  onChange={(e) => update({ publishedAt: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="unpublishedAt">Unpublish date</Label>
                <Input
                  id="unpublishedAt"
                  type="date"
                  value={form.unpublishedAt}
                  onChange={(e) => update({ unpublishedAt: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="featuredRank">Featured rank</Label>
                <Input
                  id="featuredRank"
                  type="number"
                  value={form.featuredRank}
                  onChange={(e) => update({ featuredRank: e.target.value })}
                  disabled={!canWrite || !form.featured}
                  placeholder="e.g. 1, 2, 3"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input
                id="seoTitle"
                value={form.seoTitle}
                onChange={(e) => update({ seoTitle: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="seoDescription">SEO description</Label>
              <Textarea
                id="seoDescription"
                value={form.seoDescription}
                onChange={(e) => update({ seoDescription: e.target.value })}
                disabled={!canWrite}
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="ogImage">Open Graph image URL</Label>
              <Input
                id="ogImage"
                value={form.ogImage}
                onChange={(e) => update({ ogImage: e.target.value })}
                disabled={!canWrite}
                placeholder="Leave blank to use hero image."
              />
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => update({ active: v })}
                disabled={!canWrite}
                data-testid="switch-white-paper-active"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Featured</Label>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => update({ featured: v })}
                disabled={!canWrite}
                data-testid="switch-white-paper-featured"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Hero image</Label>
            <div className="aspect-[16/9] w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {form.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.heroImage} alt="Hero" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <Input
              value={form.heroImage}
              onChange={(e) => update({ heroImage: e.target.value })}
              disabled={!canWrite}
              placeholder="Image URL"
            />
            <Input
              value={form.heroImageAlt}
              onChange={(e) => update({ heroImageAlt: e.target.value })}
              disabled={!canWrite}
              placeholder="Alt text (accessibility)"
            />
            <div className="flex gap-2">
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHeroPicker(true)}
                  data-testid="button-pick-white-paper-hero"
                >
                  {form.heroImage ? "Change" : "Pick image"}
                </Button>
              )}
              {canWrite && form.heroImage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ heroImage: "" })}
                >
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </Card>

          {!isNew && (
            <Card className="p-4">
              <TaxonomyPicker
                entityType="white_paper"
                entityId={id ?? null}
                canWrite={canWrite}
              />
            </Card>
          )}

          {!isNew && itemQ.data && (
            <Card className="p-4 space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSyncStatus(null);
                  syncMut.mutate();
                }}
                disabled={syncMut.isPending || !canWrite}
                className="w-full justify-start"
                data-testid="button-sync-white-paper-collateral"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {syncMut.isPending ? "Syncing…" : "Sync to library"}
              </Button>
              {syncStatus && (
                <p className="text-xs text-muted-foreground">{syncStatus}</p>
              )}
            </Card>
          )}

          {!isNew && itemQ.data && (
            <Card className="p-4 space-y-2 text-xs text-muted-foreground">
              <div>
                Updated{" "}
                {new Date(itemQ.data.updatedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              <div className="font-mono break-all">{itemQ.data.id}</div>
            </Card>
          )}
        </aside>
      </div>

      <MediaPickerModal
        open={showHeroPicker}
        onClose={() => setShowHeroPicker(false)}
        onSelect={handleHero}
        title="Pick hero image"
        kind="image"
      />
      <MediaPickerModal
        open={showDocumentPicker}
        onClose={() => setShowDocumentPicker(false)}
        onSelect={handleDocument}
        selectedId={form.documentMediaId}
        title="Pick document"
        kind="document"
      />
    </AdminLayout>
  );
}
