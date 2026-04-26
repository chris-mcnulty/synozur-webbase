import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, X, Image as ImageIcon, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import {
  MediaPickerModal,
  mediaUrl,
  uploadAndRegisterImage,
} from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { RevisionsPanel } from "@/components/admin/RevisionsPanel";
import {
  useCmsListServices,
  useCmsListSolutions,
  useCmsCreateSolution,
  useCmsUpdateSolution,
  useListCmsTags,
  type Service,
  type Solution,
  type UpsertSolutionBody,
  type MediaItem,
  type CollateralPillar,
} from "@workspace/api-client-react";
import { type ArtifactStatus } from "@/lib/api";

const STATUS_OPTIONS: { value: ArtifactStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const PILLAR_OPTIONS: { value: CollateralPillar; label: string }[] = [
  { value: "strategic", label: "Strategic" },
  { value: "technology", label: "Technology" },
  { value: "experiences", label: "Experiences" },
  { value: "gtm", label: "GTM" },
];

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

interface Props {
  id?: string;
}

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
  displayOrder: string;
  parentServiceId: string;
  iconId: string | null;
  iconUrl: string | null;
  routePath: string;
  buttonText: string;
  buttonUrl: string;
  heroTextHtml: string;
  heroTextColor: string;
  secondaryTitle: string;
  secondaryTextHtml: string;
  ourApproachTitle: string;
  ourApproachTextHtml: string;
  blurbHtml: string;
  blurbCopy: string;
  tagsText: string;
  blogCategory: string;
  blogTag: string;
  primaryBlogCategoryFilter: string;
  seoTitle: string;
  seoDescription: string;
  status: ArtifactStatus;
  publishedAt: string;
  unpublishedAt: string;
  pillar: CollateralPillar | null;
  tagIds: string[];
  active: boolean;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  displayOrder: "",
  parentServiceId: "",
  iconId: null,
  iconUrl: null,
  routePath: "",
  buttonText: "",
  buttonUrl: "",
  heroTextHtml: "",
  heroTextColor: "",
  secondaryTitle: "",
  secondaryTextHtml: "",
  ourApproachTitle: "",
  ourApproachTextHtml: "",
  blurbHtml: "",
  blurbCopy: "",
  tagsText: "",
  blogCategory: "",
  blogTag: "",
  primaryBlogCategoryFilter: "",
  seoTitle: "",
  seoDescription: "",
  status: "published",
  publishedAt: "",
  unpublishedAt: "",
  pillar: null,
  tagIds: [],
  active: true,
};

function fromSolution(s: Solution): FormState {
  return {
    title: s.title,
    slug: s.slug,
    displayOrder: s.displayOrder == null ? "" : String(s.displayOrder),
    parentServiceId: s.parentServiceId ?? "",
    iconId: s.iconId ?? null,
    iconUrl: s.iconUrl ?? null,
    routePath: s.routePath ?? "",
    buttonText: s.buttonText ?? "",
    buttonUrl: s.buttonUrl ?? "",
    heroTextHtml: s.heroTextHtml ?? "",
    heroTextColor: s.heroTextColor ?? "",
    secondaryTitle: s.secondaryTitle ?? "",
    secondaryTextHtml: s.secondaryTextHtml ?? "",
    ourApproachTitle: s.ourApproachTitle ?? "",
    ourApproachTextHtml: s.ourApproachTextHtml ?? "",
    blurbHtml: s.blurbHtml ?? "",
    blurbCopy: s.blurbCopy ?? "",
    tagsText: s.tagsText ?? "",
    blogCategory: s.blogCategory ?? "",
    blogTag: s.blogTag ?? "",
    primaryBlogCategoryFilter: s.primaryBlogCategoryFilter ?? "",
    seoTitle: s.seoTitle ?? "",
    seoDescription: s.seoDescription ?? "",
    status: (s.status ?? "draft") as ArtifactStatus,
    publishedAt: toDatetimeLocal(s.publishedAt),
    unpublishedAt: toDatetimeLocal(s.unpublishedAt),
    pillar: s.pillar ?? null,
    tagIds: (s.tags ?? []).map((t) => t.id),
    active: s.active,
  };
}

function toBody(f: FormState): UpsertSolutionBody {
  return {
    title: f.title,
    slug: f.slug || null,
    displayOrder: f.displayOrder === "" ? null : Number(f.displayOrder),
    parentServiceId: f.parentServiceId || null,
    iconId: f.iconId,
    routePath: f.routePath || null,
    buttonText: f.buttonText || null,
    buttonUrl: f.buttonUrl || null,
    heroTextHtml: f.heroTextHtml || null,
    heroTextColor: f.heroTextColor || null,
    secondaryTitle: f.secondaryTitle || null,
    secondaryTextHtml: f.secondaryTextHtml || null,
    ourApproachTitle: f.ourApproachTitle || null,
    ourApproachTextHtml: f.ourApproachTextHtml || null,
    blurbHtml: f.blurbHtml || null,
    blurbCopy: f.blurbCopy || null,
    tagsText: f.tagsText || null,
    blogCategory: f.blogCategory || null,
    blogTag: f.blogTag || null,
    primaryBlogCategoryFilter: f.primaryBlogCategoryFilter || null,
    seoTitle: f.seoTitle || null,
    seoDescription: f.seoDescription || null,
    status: f.status,
    publishedAt: fromDatetimeLocal(f.publishedAt),
    unpublishedAt: fromDatetimeLocal(f.unpublishedAt),
    pillar: f.pillar,
    tagIds: f.tagIds,
    active: f.active,
  };
}

export default function SolutionEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const servicesQ = useCmsListServices();
  const solutionsQ = useCmsListSolutions();
  const services: Service[] = (servicesQ.data?.items ?? []) as Service[];
  const solutions: Solution[] = (solutionsQ.data?.items ?? []) as Solution[];
  const existing = id ? solutions.find((s) => s.id === id) ?? null : null;
  const tagsQ = useListCmsTags();
  const allTags = (tagsQ.data ?? []) as { id: string; slug: string; name: string }[];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existing && !loaded) {
      setForm(fromSolution(existing));
      setSlugTouched(true);
      setLoaded(true);
    }
  }, [existing, loaded]);

  useEffect(() => {
    if (!slugTouched && form.title) {
      setForm((f) => ({ ...f, slug: slugify(f.title) }));
    }
  }, [form.title, slugTouched]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const createMut = useCmsCreateSolution({
    mutation: {
      onSuccess: (s) => {
        toast({ title: "Solution created" });
        qc.invalidateQueries({ queryKey: ["/api/cms/solutions"] });
        navigate(`/products/solutions/${s.id}/edit`);
      },
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateMut = useCmsUpdateSolution({
    mutation: {
      onSuccess: () => {
        toast({ title: "Solution saved" });
        qc.invalidateQueries({ queryKey: ["/api/cms/solutions"] });
      },
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });

  const onSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (id) {
      await updateMut.mutateAsync({ id, data: toBody(form) });
    } else {
      await createMut.mutateAsync({ data: toBody(form) });
    }
  };

  // #60: save + mint preview token + open public detail page in new tab.
  const [previewPending, setPreviewPending] = useState(false);
  const onPreview = async () => {
    if (!id) {
      toast({
        title: "Save first",
        description: "Create the solution before previewing.",
        variant: "destructive",
      });
      return;
    }
    setPreviewPending(true);
    try {
      await updateMut.mutateAsync({ id, data: toBody(form) });
      const { previewPath } = await api.createSolutionPreviewToken(id);
      window.open(previewPath, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({
        title: "Preview failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPreviewPending(false);
    }
  };

  const handleIcon = (m: MediaItem) => {
    update({ iconId: m.id, iconUrl: mediaUrl(m) });
    setShowIconPicker(false);
  };

  if (!isNew && solutionsQ.isLoading && !existing) {
    return (
      <AdminLayout title="Edit Solution">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New Solution" : `Edit: ${existing?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Solutions", href: "/products/solutions" },
        { label: isNew ? "New" : existing?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/products/solutions")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {canWrite && !isNew && (
            <Button
              variant="outline"
              onClick={onPreview}
              disabled={previewPending || updateMut.isPending}
              data-testid="button-preview-solution"
            >
              <Eye className="h-4 w-4 mr-1" />
              {previewPending ? "Opening…" : "Preview"}
            </Button>
          )}
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-solution"
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
          You have read-only access. Only editors and admins can change solutions.
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
                data-testid="input-solution-title"
                className="text-xl font-semibold h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-solution-slug"
                />
              </div>
              <div>
                <Label htmlFor="parent">Parent service</Label>
                <Select
                  value={form.parentServiceId || "__none__"}
                  onValueChange={(v) =>
                    update({ parentServiceId: v === "__none__" ? "" : v })
                  }
                  disabled={!canWrite}
                >
                  <SelectTrigger id="parent" data-testid="select-solution-parent">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="displayOrder">Display order</Label>
                <Input
                  id="displayOrder"
                  type="number"
                  value={form.displayOrder}
                  onChange={(e) => update({ displayOrder: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="routePath">Route path</Label>
                <Input
                  id="routePath"
                  value={form.routePath}
                  onChange={(e) => update({ routePath: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="buttonText">Button text</Label>
                <Input
                  id="buttonText"
                  value={form.buttonText}
                  onChange={(e) => update({ buttonText: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="buttonUrl">Button URL</Label>
                <Input
                  id="buttonUrl"
                  value={form.buttonUrl}
                  onChange={(e) => update({ buttonUrl: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-[1fr_180px] gap-4">
              <div>
                <Label>Hero text</Label>
                <RichTextEditor
                  value={form.heroTextHtml}
                  onChange={({ html }) => update({ heroTextHtml: html })}
                  onUploadImage={uploadAndRegisterImage}
                />
              </div>
              <div>
                <Label htmlFor="heroTextColor">Hero text color</Label>
                <Input
                  id="heroTextColor"
                  value={form.heroTextColor}
                  onChange={(e) => update({ heroTextColor: e.target.value })}
                  placeholder="#ffffff"
                  disabled={!canWrite}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label htmlFor="secondaryTitle">Secondary title</Label>
              <Input
                id="secondaryTitle"
                value={form.secondaryTitle}
                onChange={(e) => update({ secondaryTitle: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label>Secondary text</Label>
              <RichTextEditor
                value={form.secondaryTextHtml}
                onChange={({ html }) => update({ secondaryTextHtml: html })}
                onUploadImage={uploadAndRegisterImage}
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label htmlFor="ourApproachTitle">Our approach title</Label>
              <Input
                id="ourApproachTitle"
                value={form.ourApproachTitle}
                onChange={(e) => update({ ourApproachTitle: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label>Our approach text</Label>
              <RichTextEditor
                value={form.ourApproachTextHtml}
                onChange={({ html }) => update({ ourApproachTextHtml: html })}
                onUploadImage={uploadAndRegisterImage}
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label>Blurb</Label>
              <RichTextEditor
                value={form.blurbHtml}
                onChange={({ html }) => update({ blurbHtml: html })}
                onUploadImage={uploadAndRegisterImage}
              />
            </div>
            <div>
              <Label htmlFor="blurbCopy">Blurb copy</Label>
              <Textarea
                id="blurbCopy"
                rows={2}
                value={form.blurbCopy}
                onChange={(e) => update({ blurbCopy: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="tagsText">Tags text</Label>
              <Textarea
                id="tagsText"
                rows={2}
                value={form.tagsText}
                onChange={(e) => update({ tagsText: e.target.value })}
                disabled={!canWrite}
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="blogCategory">Blog category</Label>
                <Input
                  id="blogCategory"
                  value={form.blogCategory}
                  onChange={(e) => update({ blogCategory: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="blogTag">Blog tag</Label>
                <Input
                  id="blogTag"
                  value={form.blogTag}
                  onChange={(e) => update({ blogTag: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="primaryBlogCategoryFilter">
                  Primary blog category filter
                </Label>
                <Input
                  id="primaryBlogCategoryFilter"
                  value={form.primaryBlogCategoryFilter}
                  onChange={(e) =>
                    update({ primaryBlogCategoryFilter: e.target.value })
                  }
                  disabled={!canWrite}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label className="text-sm font-medium">SEO</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Overrides the page title and meta description on this
                solution's public detail page. Leave blank to use the title and
                blurb.
              </p>
            </div>
            <div>
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input
                id="seoTitle"
                value={form.seoTitle}
                maxLength={70}
                placeholder="e.g. AI Strategy & Roadmap | Synozur"
                onChange={(e) => update({ seoTitle: e.target.value })}
                disabled={!canWrite}
                data-testid="input-solution-seo-title"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {form.seoTitle.length}/70 characters — Google typically
                truncates past ~60.
              </div>
            </div>
            <div>
              <Label htmlFor="seoDescription">SEO description</Label>
              <Textarea
                id="seoDescription"
                rows={3}
                maxLength={300}
                value={form.seoDescription}
                onChange={(e) => update({ seoDescription: e.target.value })}
                disabled={!canWrite}
                data-testid="input-solution-seo-description"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {form.seoDescription.length}/300 characters — aim for 150–160.
              </div>
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Publish status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => update({ status: v as ArtifactStatus })}
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="select-solution-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div>
              <Label htmlFor="publishedAt" className="text-xs">
                Publish at
              </Label>
              <Input
                id="publishedAt"
                type="datetime-local"
                value={form.publishedAt}
                onChange={(e) => update({ publishedAt: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="unpublishedAt" className="text-xs">
                Retire at
              </Label>
              <Input
                id="unpublishedAt"
                type="datetime-local"
                value={form.unpublishedAt}
                onChange={(e) => update({ unpublishedAt: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <Label className="text-sm font-medium">Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => update({ active: v })}
                disabled={!canWrite}
                data-testid="switch-solution-active"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Pillar</Label>
            <Select
              value={form.pillar ?? "__none__"}
              onValueChange={(v) =>
                update({
                  pillar: v === "__none__" ? null : (v as CollateralPillar),
                })
              }
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="select-solution-pillar">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {PILLAR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used to group solutions into the library's pillar rails.
            </p>
          </Card>

          <Card className="p-4 space-y-2">
            <Label className="text-sm font-medium">Tags</Label>
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tags defined yet. Create tags under Admin → Taxonomy.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {allTags.map((t) => {
                  const checked = form.tagIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:text-primary"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canWrite}
                        onChange={(e) =>
                          update({
                            tagIds: e.target.checked
                              ? [...form.tagIds, t.id]
                              : form.tagIds.filter((x) => x !== t.id),
                          })
                        }
                      />
                      <span>{t.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {t.slug}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Icon</Label>
            <div className="w-24 h-24 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {form.iconUrl ? (
                <img src={form.iconUrl} alt="Icon" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex gap-2">
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowIconPicker(true)}
                  data-testid="button-pick-solution-icon"
                >
                  {form.iconUrl ? "Change" : "Pick image"}
                </Button>
              )}
              {canWrite && form.iconUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ iconId: null, iconUrl: null })}
                >
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </Card>

          {!isNew && existing && (
            <Card className="p-4 space-y-2 text-xs text-muted-foreground">
              <div>
                Updated{" "}
                {new Date(existing.updatedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              <div className="font-mono break-all">{existing.id}</div>
            </Card>
          )}
        </aside>
      </div>

      {!isNew && id && (
        <RevisionsPanel
          kind="solution"
          id={id}
          invalidateKeys={[["/api/cms/solutions"]]}
        />
      )}

      <MediaPickerModal
        open={showIconPicker}
        onClose={() => setShowIconPicker(false)}
        onSelect={handleIcon}
        selectedId={form.iconId}
        title="Choose solution icon"
        categorySlug="service-icon"
      />
    </AdminLayout>
  );
}
