import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, X, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
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
import {
  AssetLibraryModal,
  assetUrl,
} from "@/components/admin/AssetLibraryModal";
import { TaxonomyPicker } from "@/components/admin/TaxonomyPicker";
import { useToast } from "@/hooks/use-toast";
import { CollateralCard } from "@/components/collateral-card";
import type { Collateral } from "@/data/collateral";
import type { Asset } from "@workspace/api-zod/types";
import {
  useCmsListCollateral,
  useCmsCreateCollateral,
  useCmsUpdateCollateral,
  type CollateralItem,
  type UpsertCollateralBody,
} from "@workspace/api-client-react";

interface Props {
  id?: string;
}

const TYPES: { value: UpsertCollateralBody["type"]; label: string }[] = [
  { value: "white_paper", label: "White Paper" },
  { value: "webinar", label: "Webinar" },
  { value: "case_study", label: "Case Study" },
  { value: "podcast", label: "Podcast" },
  { value: "model", label: "Model" },
  { value: "training", label: "Workshop" },
  { value: "event", label: "Event" },
  { value: "insight", label: "Insight" },
];

const PILLARS: { value: NonNullable<UpsertCollateralBody["pillar"]>; label: string }[] = [
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
  type: UpsertCollateralBody["type"];
  pillar: string; // "" = none
  subtitle: string;
  description: string;
  heroImage: string;
  url: string;
  external: boolean;
  publishedAt: string; // YYYY-MM-DD
  featured: boolean;
  featuredRank: string;
  videoUrl: string;
  downloadUrl: string;
  tagsText: string;
  active: boolean;
  // #100 — real foreign keys to the services/solutions tables replace the
  // fragile `pillar` string heuristic for filtered rails. Empty string = unset.
  serviceId: string;
  solutionId: string;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  type: "white_paper",
  pillar: "",
  subtitle: "",
  description: "",
  heroImage: "",
  url: "",
  external: false,
  publishedAt: "",
  featured: false,
  featuredRank: "",
  videoUrl: "",
  downloadUrl: "",
  tagsText: "",
  active: true,
  serviceId: "",
  solutionId: "",
};

function fromItem(item: CollateralItem): FormState {
  // serviceId / solutionId are not yet in the generated CollateralItem type
  // (the OpenAPI spec is regenerated separately). Read them via a loose cast
  // so the UI can round-trip the FK fields once the server response carries
  // them (#100 / #100.5).
  const extra = item as unknown as {
    serviceId?: string | null;
    solutionId?: string | null;
  };
  return {
    title: item.title,
    slug: item.slug,
    type: item.type,
    pillar: item.pillar ?? "",
    subtitle: item.subtitle ?? "",
    description: item.description ?? "",
    heroImage: item.heroImage ?? "",
    url: item.url ?? "",
    external: !!item.external,
    publishedAt: item.publishedAt ?? "",
    featured: !!item.featured,
    featuredRank: item.featuredRank == null ? "" : String(item.featuredRank),
    videoUrl: item.videoUrl ?? "",
    downloadUrl: item.downloadUrl ?? "",
    tagsText: (item.tags ?? []).join(", "),
    active: item.active,
    serviceId: extra.serviceId ?? "",
    solutionId: extra.solutionId ?? "",
  };
}

function toPreviewItem(f: FormState): Collateral {
  const tags = f.tagsText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    id: "preview",
    slug: f.slug || "preview",
    type: f.type,
    title: f.title || "Untitled",
    subtitle: f.subtitle || undefined,
    description: f.description ?? "",
    heroImage: f.heroImage || "",
    pillar: (f.pillar || undefined) as Collateral["pillar"],
    tags,
    url: f.url || "#",
    external: f.external,
    publishedAt: f.publishedAt || "",
    featured: f.featured,
    featuredRank: f.featuredRank === "" ? undefined : Number(f.featuredRank),
    videoUrl: f.videoUrl || undefined,
    downloadUrl: f.downloadUrl || undefined,
  };
}

function toBody(f: FormState): UpsertCollateralBody {
  const tags = f.tagsText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const body: UpsertCollateralBody & {
    serviceId?: string | null;
    solutionId?: string | null;
  } = {
    title: f.title,
    slug: f.slug || null,
    type: f.type,
    pillar: (f.pillar || null) as UpsertCollateralBody["pillar"],
    subtitle: f.subtitle || null,
    description: f.description ?? "",
    heroImage: f.heroImage ?? "",
    url: f.url ?? "",
    external: f.external,
    publishedAt: f.publishedAt || null,
    featured: f.featured,
    featuredRank: f.featuredRank === "" ? null : Number(f.featuredRank),
    videoUrl: f.videoUrl || null,
    downloadUrl: f.downloadUrl || null,
    tags,
    active: f.active,
    serviceId: f.serviceId || null,
    solutionId: f.solutionId || null,
  };
  return body;
}

export default function CollateralEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  // Services + solutions power the new FK pickers (#100).
  const servicesQ = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
  });
  const services = servicesQ.data?.items ?? [];
  const solutionsForService = useMemo(() => {
    return services.map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      solutions: s.solutions,
    }));
  }, [services]);

  const listQ = useCmsListCollateral();
  const all: CollateralItem[] = (listQ.data?.items ?? []) as CollateralItem[];
  const existing = id ? all.find((x) => x.id === id) ?? null : null;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existing && !loaded) {
      setForm(fromItem(existing));
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

  const invalidatePublic = () => {
    qc.invalidateQueries({ queryKey: ["/api/cms/collateral"] });
    qc.invalidateQueries({ queryKey: ["collateral"] });
  };

  const createMut = useCmsCreateCollateral({
    mutation: {
      onSuccess: (item) => {
        toast({ title: "Library item created" });
        invalidatePublic();
        navigate(`/library/collateral/${item.id}/edit`);
      },
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });

  const updateMut = useCmsUpdateCollateral({
    mutation: {
      onSuccess: () => {
        toast({ title: "Library item saved" });
        invalidatePublic();
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

  const handleHero = (asset: Asset) => {
    update({ heroImage: assetUrl(asset) });
    setShowHeroPicker(false);
  };

  if (!isNew && listQ.isLoading && !existing) {
    return (
      <AdminLayout title="Edit Library Item">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New Library Item" : `Edit: ${existing?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Library", href: "/library/collateral" },
        { label: isNew ? "New" : existing?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/library/collateral")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-collateral"
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
          You have read-only access. Only editors and admins can change library items.
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
                data-testid="input-collateral-title"
                className="text-xl font-semibold h-11"
              />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/items/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-collateral-slug"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => update({ type: v as UpsertCollateralBody["type"] })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="type" data-testid="select-collateral-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
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
                  <SelectTrigger id="pillar" data-testid="select-collateral-pillar">
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
                      // Clear solution when the service changes if the chosen
                      // solution no longer belongs to the new parent.
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
                  <SelectTrigger id="serviceId" data-testid="select-collateral-service">
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
                  onValueChange={(v) => update({ solutionId: v === "__none__" ? "" : v })}
                  disabled={!canWrite || servicesQ.isLoading}
                >
                  <SelectTrigger id="solutionId" data-testid="select-collateral-solution">
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
              <Label htmlFor="subtitle">Subtitle</Label>
              <Input
                id="subtitle"
                value={form.subtitle}
                onChange={(e) => update({ subtitle: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                disabled={!canWrite}
                rows={4}
                data-testid="input-collateral-description"
              />
            </div>
            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={form.tagsText}
                onChange={(e) => update({ tagsText: e.target.value })}
                disabled={!canWrite}
                placeholder="leadership, strategy, ai"
                data-testid="input-collateral-tags"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="url">Canonical URL</Label>
              <Input
                id="url"
                value={form.url}
                onChange={(e) => update({ url: e.target.value })}
                disabled={!canWrite}
                placeholder="/case-studies/example or https://example.com"
                data-testid="input-collateral-url"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="external" className="text-sm font-medium">
                External link (opens in new tab)
              </Label>
              <Switch
                id="external"
                checked={form.external}
                onCheckedChange={(v) => update({ external: v })}
                disabled={!canWrite}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="videoUrl">Video URL</Label>
                <Input
                  id="videoUrl"
                  value={form.videoUrl}
                  onChange={(e) => update({ videoUrl: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="downloadUrl">Download URL</Label>
                <Input
                  id="downloadUrl"
                  value={form.downloadUrl}
                  onChange={(e) => update({ downloadUrl: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="publishedAt">Published date</Label>
              <Input
                id="publishedAt"
                type="date"
                value={form.publishedAt}
                onChange={(e) => update({ publishedAt: e.target.value })}
                disabled={!canWrite}
              />
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Preview card</Label>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Live
              </span>
            </div>
            <div data-testid="preview-collateral-card" className="pointer-events-none">
              <CollateralCard item={toPreviewItem(form)} variant="grid" />
            </div>
            <p className="text-xs text-muted-foreground">
              How this item will appear in the library grid. Unsaved changes shown.
            </p>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => update({ active: v })}
                disabled={!canWrite}
                data-testid="switch-collateral-active"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Featured</Label>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => update({ featured: v })}
                disabled={!canWrite}
                data-testid="switch-collateral-featured"
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
                data-testid="input-collateral-featured-rank"
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
              data-testid="input-collateral-hero-image"
            />
            <div className="flex gap-2">
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHeroPicker(true)}
                  data-testid="button-pick-collateral-hero"
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
                entityType="collateral"
                entityId={id ?? null}
                canWrite={canWrite}
              />
            </Card>
          )}

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

      <AssetLibraryModal
        open={showHeroPicker}
        onClose={() => setShowHeroPicker(false)}
        onSelect={handleHero}
      />
    </AdminLayout>
  );
}
