import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  X,
  Plus,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { api, type ModelDto, type ModelRelatedItemDto } from "@/lib/api";
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
import { ActivityTab } from "@/components/admin/ActivityTab";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  MediaPickerModal,
  mediaUrl,
} from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import type { MediaItem } from "@workspace/api-client-react";

interface Props {
  id?: string;
}

const PILLARS = [
  { value: "strategic", label: "Strategic Transformation" },
  { value: "technology", label: "Technology Transformation" },
  { value: "experiences", label: "Experiences" },
  { value: "gtm", label: "Go-to-Market" },
] as const;

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

const RELATED_KINDS = [
  { value: "link", label: "Link" },
  { value: "white-paper", label: "White Paper" },
  { value: "video", label: "Video" },
  { value: "case-study", label: "Case Study" },
] as const;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

interface FormState {
  title: string;
  slug: string;
  status: string;
  pillar: string;
  serviceId: string;
  solutionId: string;
  shortDescription: string;
  heroImage: string;
  longDescriptionHtml: string;
  dimensionsHtml: string;
  launchUrl: string;
  relatedInformation: ModelRelatedItemDto[];
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
  status: "draft",
  pillar: "",
  serviceId: "",
  solutionId: "",
  shortDescription: "",
  heroImage: "",
  longDescriptionHtml: "",
  dimensionsHtml: "",
  launchUrl: "",
  relatedInformation: [],
  publishedAt: "",
  unpublishedAt: "",
  featured: false,
  featuredRank: "",
  seoTitle: "",
  seoDescription: "",
  ogImage: "",
  active: true,
};

function fromDto(m: ModelDto): FormState {
  return {
    title: m.title,
    slug: m.slug,
    status: m.status,
    pillar: m.pillar ?? "",
    serviceId: m.serviceId ?? "",
    solutionId: m.solutionId ?? "",
    shortDescription: m.shortDescription ?? "",
    heroImage: m.heroImage ?? "",
    longDescriptionHtml: m.longDescriptionHtml ?? "",
    dimensionsHtml: m.dimensionsHtml ?? "",
    launchUrl: m.launchUrl ?? "",
    relatedInformation: m.relatedInformation ?? [],
    publishedAt: toDateInput(m.publishedAt),
    unpublishedAt: toDateInput(m.unpublishedAt),
    featured: m.featured,
    featuredRank: m.featuredRank == null ? "" : String(m.featuredRank),
    seoTitle: m.seoTitle ?? "",
    seoDescription: m.seoDescription ?? "",
    ogImage: m.ogImage ?? "",
    active: m.active,
  };
}

function toBody(f: FormState) {
  return {
    title: f.title,
    slug: f.slug || null,
    status: f.status as ModelDto["status"],
    pillar: (f.pillar || null) as ModelDto["pillar"],
    serviceId: f.serviceId || null,
    solutionId: f.solutionId || null,
    shortDescription: f.shortDescription,
    heroImage: f.heroImage,
    longDescriptionHtml: f.longDescriptionHtml,
    dimensionsHtml: f.dimensionsHtml,
    launchUrl: f.launchUrl || undefined,
    relatedInformation: f.relatedInformation,
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

export default function ModelEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const servicesQ = useQuery({
    queryKey: ["admin-services-with-solutions"],
    queryFn: () => api.listServicesAdmin(),
  });
  const services = servicesQ.data?.items ?? [];

  const solutionsForService = useMemo(
    () =>
      services.map((s) => ({
        id: s.id,
        title: s.title,
        solutions: s.solutions,
      })),
    [services],
  );

  const modelQ = useQuery({
    queryKey: ["admin-model", id],
    queryFn: () => api.adminGetModel(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [showOgPicker, setShowOgPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (modelQ.data && !loaded) {
      setForm(fromDto(modelQ.data));
      setSlugTouched(true);
      setLoaded(true);
    }
  }, [modelQ.data, loaded]);

  useEffect(() => {
    if (!slugTouched && form.title) {
      setForm((f) => ({ ...f, slug: slugify(f.title) }));
    }
  }, [form.title, slugTouched]);

  const update = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-models"] });
    qc.invalidateQueries({ queryKey: ["admin-model", id] });
    qc.invalidateQueries({ queryKey: ["models"] });
  };

  const createMut = useMutation({
    mutationFn: (body: ReturnType<typeof toBody>) => api.createModel(body),
    onSuccess: (created) => {
      toast({ title: "Model created" });
      invalidate();
      navigate(`/products/models/${created.id}/edit`);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: ReturnType<typeof toBody>) => api.updateModel(id!, body),
    onSuccess: () => {
      toast({ title: "Model saved" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const onSave = () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const body = toBody(form);
    if (isNew) {
      createMut.mutate(body);
    } else {
      updateMut.mutate(body);
    }
  };

  const addRelated = () =>
    update({
      relatedInformation: [
        ...form.relatedInformation,
        { label: "", url: "", kind: "link" },
      ],
    });

  const updateRelated = (
    i: number,
    patch: Partial<ModelRelatedItemDto>,
  ) => {
    const next = form.relatedInformation.map((r, idx) =>
      idx === i ? { ...r, ...patch } : r,
    );
    update({ relatedInformation: next });
  };

  const removeRelated = (i: number) => {
    update({
      relatedInformation: form.relatedInformation.filter((_, idx) => idx !== i),
    });
  };

  if (!isNew && modelQ.isLoading) {
    return (
      <AdminLayout title="Edit Model">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  const title = isNew ? "New Model" : `Edit: ${modelQ.data?.title ?? ""}`;

  return (
    <AdminLayout
      title={title}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Models", href: "/products/models" },
        { label: isNew ? "New" : (modelQ.data?.title ?? "Edit") },
      ]}
      previewEntity={{
        kind: "model",
        id,
        slug: form.slug,
        isDraft: form.status !== "published",
      }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/products/models")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {!isNew && modelQ.data && (
            <a
              href={`/models/${modelQ.data.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" /> Preview
              </Button>
            </a>
          )}
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-model"
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
          You have read-only access. Only editors and admins can change models.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-4 min-w-0">
          {/* Core fields */}
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                disabled={!canWrite}
                className="text-xl font-semibold h-11"
                data-testid="input-model-title"
              />
            </div>

            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/models/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-model-slug"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => update({ status: v })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="status" data-testid="select-model-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pillar">Pillar</Label>
                <Select
                  value={form.pillar || "__none__"}
                  onValueChange={(v) =>
                    update({ pillar: v === "__none__" ? "" : v })
                  }
                  disabled={!canWrite}
                >
                  <SelectTrigger id="pillar">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {PILLARS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="serviceId">Service</Label>
                <Select
                  value={form.serviceId || "__none__"}
                  onValueChange={(v) =>
                    update({
                      serviceId: v === "__none__" ? "" : v,
                      solutionId:
                        v === "__none__"
                          ? ""
                          : solutionsForService
                                .find((s) => s.id === v)
                                ?.solutions.some((sol) => sol.id === form.solutionId)
                            ? form.solutionId
                            : "",
                    })
                  }
                  disabled={!canWrite || servicesQ.isLoading}
                >
                  <SelectTrigger id="serviceId">
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
                <p className="text-xs text-muted-foreground mt-1">
                  Powers service filtered rails. Replaces the pillar heuristic.
                </p>
              </div>
              <div>
                <Label htmlFor="solutionId">Solution</Label>
                <Select
                  value={form.solutionId || "__none__"}
                  onValueChange={(v) =>
                    update({ solutionId: v === "__none__" ? "" : v })
                  }
                  disabled={!canWrite || servicesQ.isLoading}
                >
                  <SelectTrigger id="solutionId">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {services.flatMap((s) =>
                      s.solutions.map((sol) => (
                        <SelectItem key={sol.id} value={sol.id}>
                          {s.title} — {sol.title}
                        </SelectItem>
                      )),
                    )}
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
                placeholder="One or two sentence summary shown on the models grid card."
                data-testid="input-model-short-description"
              />
            </div>
          </Card>

          {/* Rich content */}
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="longDescriptionHtml">Long description (HTML)</Label>
              <Textarea
                id="longDescriptionHtml"
                value={form.longDescriptionHtml}
                onChange={(e) => update({ longDescriptionHtml: e.target.value })}
                disabled={!canWrite}
                rows={8}
                className="font-mono text-xs"
                placeholder="<p>Full model description…</p>"
              />
            </div>
            <div>
              <Label htmlFor="dimensionsHtml">Assessment dimensions (HTML)</Label>
              <Textarea
                id="dimensionsHtml"
                value={form.dimensionsHtml}
                onChange={(e) => update({ dimensionsHtml: e.target.value })}
                disabled={!canWrite}
                rows={6}
                className="font-mono text-xs"
                placeholder="<p>Dimension list HTML…</p>"
              />
            </div>
          </Card>

          {/* Links */}
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="launchUrl">Launch URL (Orion / assessment app)</Label>
              <Input
                id="launchUrl"
                value={form.launchUrl}
                onChange={(e) => update({ launchUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="https://orion.synozur.com/your-model"
                data-testid="input-model-launch-url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Appears as the primary CTA on the model detail page. Auto-synced
                to the collateral row on save.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
            </div>

            {/* Related information */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Related information</Label>
                {canWrite && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addRelated}
                    type="button"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add link
                  </Button>
                )}
              </div>
              {form.relatedInformation.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No related links yet.
                </p>
              )}
              <div className="space-y-2">
                {form.relatedInformation.map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_120px_32px] gap-2 items-center"
                  >
                    <Input
                      placeholder="Label"
                      value={r.label}
                      onChange={(e) =>
                        updateRelated(i, { label: e.target.value })
                      }
                      disabled={!canWrite}
                      className="text-sm"
                    />
                    <Input
                      placeholder="https://…"
                      value={r.url}
                      onChange={(e) =>
                        updateRelated(i, { url: e.target.value })
                      }
                      disabled={!canWrite}
                      className="text-sm"
                    />
                    <Select
                      value={r.kind ?? "link"}
                      onValueChange={(v) =>
                        updateRelated(i, {
                          kind: v as ModelRelatedItemDto["kind"],
                        })
                      }
                      disabled={!canWrite}
                    >
                      <SelectTrigger className="text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RELATED_KINDS.map((k) => (
                          <SelectItem key={k.value} value={k.value}>
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeRelated(i)}
                        type="button"
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* SEO */}
          <Card className="p-4 space-y-4">
            <p className="text-sm font-medium">SEO</p>
            <div>
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input
                id="seoTitle"
                value={form.seoTitle}
                onChange={(e) => update({ seoTitle: e.target.value })}
                disabled={!canWrite}
                placeholder="Overrides page title in search results"
              />
            </div>
            <div>
              <Label htmlFor="seoDescription">SEO description</Label>
              <Textarea
                id="seoDescription"
                value={form.seoDescription}
                onChange={(e) => update({ seoDescription: e.target.value })}
                disabled={!canWrite}
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="ogImage">OG image URL</Label>
              <div className="flex gap-2">
                <Input
                  id="ogImage"
                  value={form.ogImage}
                  onChange={(e) => update({ ogImage: e.target.value })}
                  disabled={!canWrite}
                  placeholder="https://…"
                />
                {canWrite && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowOgPicker(true)}
                    type="button"
                  >
                    Pick
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => update({ active: v })}
                disabled={!canWrite}
                data-testid="switch-model-active"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Featured</Label>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => update({ featured: v })}
                disabled={!canWrite}
                data-testid="switch-model-featured"
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
                placeholder="e.g. 1"
                data-testid="input-model-featured-rank"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Lower numbers appear first in the home carousel.
              </p>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Hero image</Label>
            <div className="aspect-video w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {form.heroImage ? (
                <img
                  src={form.heroImage}
                  alt="Hero"
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <Input
              value={form.heroImage}
              onChange={(e) => update({ heroImage: e.target.value })}
              disabled={!canWrite}
              placeholder="Image URL"
              data-testid="input-model-hero-image"
            />
            <div className="flex gap-2">
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHeroPicker(true)}
                  type="button"
                >
                  {form.heroImage ? "Change" : "Pick image"}
                </Button>
              )}
              {canWrite && form.heroImage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ heroImage: "" })}
                  type="button"
                >
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </Card>

          {!isNew && modelQ.data && (
            <Card className="p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Collateral sync
              </p>
              <p className="text-xs text-muted-foreground">
                Saving this model automatically updates the matching Library →
                Collateral row (type: model). The collateral card links to{" "}
                <code className="text-[10px]">/models/{modelQ.data.slug}</code>; the
                Orion launch URL stays on the detail page.
              </p>
            </Card>
          )}
        </aside>
      </div>

      {showHeroPicker && (
        <MediaPickerModal
          open
          onSelect={(m: MediaItem) => {
            update({ heroImage: mediaUrl(m) });
            setShowHeroPicker(false);
          }}
          onClose={() => setShowHeroPicker(false)}
        />
      )}
      {showOgPicker && (
        <MediaPickerModal
          open
          onSelect={(m: MediaItem) => {
            update({ ogImage: mediaUrl(m) });
            setShowOgPicker(false);
          }}
          onClose={() => setShowOgPicker(false)}
        />
      )}
      <div className="mt-6">
        <ActivityTab entity="model" entityId={id} />
      </div>
    </AdminLayout>
  );
}
