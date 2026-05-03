import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, X, Image as ImageIcon, RefreshCw } from "lucide-react";
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
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import { TaxonomyPicker } from "@/components/admin/TaxonomyPicker";
import { useToast } from "@/hooks/use-toast";
import type { MediaItem } from "@workspace/api-client-react";
import {
  api,
  VIDEO_CATEGORIES,
  VIDEO_STATUSES,
  type VideoDto,
  type VideoInput,
  type VideoCategory,
  type VideoStatus,
} from "@/lib/api";

interface Props {
  id?: string;
}

const CATEGORY_LABELS: Record<VideoCategory, string> = {
  interview: "Interview",
  webinar: "Webinar",
  demo: "Demo",
  talk: "Talk",
  clip: "Clip",
  other: "Other",
};

const STATUS_LABELS: Record<VideoStatus, string> = {
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
  category: VideoCategory;
  videoUrl: string;
  thumbnailUrl: string;
  heroImage: string;
  heroImageAlt: string;
  shortDescription: string;
  bodyHtml: string;
  tagsText: string;
  pillar: string;
  recordedAt: string;
  durationSeconds: string;
  status: VideoStatus;
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
  category: "webinar",
  videoUrl: "",
  thumbnailUrl: "",
  heroImage: "",
  heroImageAlt: "",
  shortDescription: "",
  bodyHtml: "",
  tagsText: "",
  pillar: "",
  recordedAt: "",
  durationSeconds: "",
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

function fromItem(item: VideoDto): FormState {
  return {
    title: item.title,
    slug: item.slug,
    category: item.category,
    videoUrl: item.videoUrl ?? "",
    thumbnailUrl: item.thumbnailUrl ?? "",
    heroImage: item.heroImage ?? "",
    heroImageAlt: item.heroImageAlt ?? "",
    shortDescription: item.shortDescription ?? "",
    bodyHtml: item.bodyHtml ?? "",
    tagsText: (item.tags ?? []).join(", "),
    pillar: item.pillar ?? "",
    recordedAt: toDateInput(item.recordedAt),
    durationSeconds: item.durationSeconds == null ? "" : String(item.durationSeconds),
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

function toBody(f: FormState): VideoInput {
  const tags = f.tagsText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    title: f.title,
    slug: f.slug || null,
    category: f.category,
    videoUrl: f.videoUrl ?? "",
    thumbnailUrl: f.thumbnailUrl || null,
    heroImage: f.heroImage ?? "",
    heroImageAlt: f.heroImageAlt || null,
    shortDescription: f.shortDescription ?? "",
    bodyHtml: f.bodyHtml ?? "",
    tags,
    pillar: f.pillar || null,
    recordedAt: f.recordedAt || null,
    durationSeconds: f.durationSeconds === "" ? null : Number(f.durationSeconds),
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

export default function VideoEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const itemQ = useQuery({
    queryKey: ["admin-video", id],
    queryFn: () => api.adminGetVideo(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
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
    qc.invalidateQueries({ queryKey: ["admin-videos"] });
    qc.invalidateQueries({ queryKey: ["admin-video", id] });
    qc.invalidateQueries({ queryKey: ["public-videos"] });
    qc.invalidateQueries({ queryKey: ["/api/cms/collateral"] });
    qc.invalidateQueries({ queryKey: ["collateral"] });
  };

  const createMut = useMutation({
    mutationFn: (body: VideoInput) => api.createVideo(body),
    onSuccess: (created) => {
      toast({ title: "Video created" });
      invalidate();
      navigate(`/library/videos/${created.id}/edit`);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: VideoInput) => api.updateVideo(id!, body),
    onSuccess: () => {
      toast({ title: "Video saved" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const syncMut = useMutation({
    mutationFn: () => api.syncVideoToCollateral(id!),
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

  if (!isNew && itemQ.isLoading && !loaded) {
    return (
      <AdminLayout title="Edit Video">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New Video" : `Edit: ${itemQ.data?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Videos", href: "/library/videos" },
        { label: isNew ? "New" : itemQ.data?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/library/videos")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-video"
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
          You have read-only access. Only editors and admins can change videos.
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
                data-testid="input-video-title"
                className="text-xl font-semibold h-11"
              />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/videos/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-video-slug"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => update({ category: v as VideoCategory })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="category" data-testid="select-video-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
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
                  <SelectTrigger id="pillar" data-testid="select-video-pillar">
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
                placeholder="One-sentence summary shown on list pages and cards."
                data-testid="input-video-short-description"
              />
            </div>
            <div>
              <Label htmlFor="bodyHtml">Body (HTML)</Label>
              <Textarea
                id="bodyHtml"
                value={form.bodyHtml}
                onChange={(e) => update({ bodyHtml: e.target.value })}
                disabled={!canWrite}
                rows={10}
                className="font-mono text-sm"
                placeholder="<p>Full description, notes, resources, links...</p>"
                data-testid="input-video-body-html"
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
                data-testid="input-video-tags"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="videoUrl">Video URL (YouTube / Vimeo / Wistia)</Label>
              <Input
                id="videoUrl"
                value={form.videoUrl}
                onChange={(e) => update({ videoUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="https://youtu.be/..."
                data-testid="input-video-url"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="recordedAt">Recorded date</Label>
                <Input
                  id="recordedAt"
                  type="date"
                  value={form.recordedAt}
                  onChange={(e) => update({ recordedAt: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="durationSeconds">Duration (seconds)</Label>
                <Input
                  id="durationSeconds"
                  type="number"
                  value={form.durationSeconds}
                  onChange={(e) => update({ durationSeconds: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="thumbnailUrl">Custom thumbnail URL (optional)</Label>
              <Input
                id="thumbnailUrl"
                value={form.thumbnailUrl}
                onChange={(e) => update({ thumbnailUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="Leave blank to use hero image or provider default."
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
                  onValueChange={(v) => update({ status: v as VideoStatus })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="status" data-testid="select-video-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_STATUSES.map((s) => (
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
                data-testid="switch-video-active"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Featured</Label>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => update({ featured: v })}
                disabled={!canWrite}
                data-testid="switch-video-featured"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Hero image</Label>
            <div className="aspect-video w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {form.heroImage ? (
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
                  data-testid="button-pick-video-hero"
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
                entityType="video"
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
                data-testid="button-sync-video-collateral"
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
        kind="image"
      />
    </AdminLayout>
  );
}
