import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Image as ImageIcon } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import {
  api,
  type PolarisEpisodeDto,
  type PolarisEpisodeInput,
  type ArtifactStatus,
} from "@/lib/api";

interface Props {
  id?: string;
}

const STATUSES: ArtifactStatus[] = ["draft", "scheduled", "published", "archived"];
const STATUS_LABELS: Record<ArtifactStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

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
  episodeNumber: string;
  summary: string;
  guestName: string;
  audioUrl: string;
  appleUrl: string;
  spotifyUrl: string;
  durationSeconds: string;
  transcriptHtml: string;
  artworkUrl: string;
  status: ArtifactStatus;
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
  episodeNumber: "",
  summary: "",
  guestName: "",
  audioUrl: "",
  appleUrl: "",
  spotifyUrl: "",
  durationSeconds: "",
  transcriptHtml: "",
  artworkUrl: "",
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

function fromItem(item: PolarisEpisodeDto): FormState {
  return {
    title: item.title,
    slug: item.slug,
    episodeNumber: String(item.episodeNumber),
    summary: item.summary ?? "",
    guestName: item.guestName ?? "",
    audioUrl: item.audioUrl ?? "",
    appleUrl: item.appleUrl ?? "",
    spotifyUrl: item.spotifyUrl ?? "",
    durationSeconds: item.durationSeconds == null ? "" : String(item.durationSeconds),
    transcriptHtml: item.transcriptHtml ?? "",
    artworkUrl: item.artworkUrl ?? "",
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

function toBody(f: FormState): PolarisEpisodeInput {
  return {
    title: f.title,
    slug: f.slug || null,
    episodeNumber: Number(f.episodeNumber),
    summary: f.summary ?? "",
    guestName: f.guestName || null,
    audioUrl: f.audioUrl ?? "",
    appleUrl: f.appleUrl || null,
    spotifyUrl: f.spotifyUrl || null,
    durationSeconds: f.durationSeconds === "" ? null : Number(f.durationSeconds),
    transcriptHtml: f.transcriptHtml || null,
    artworkUrl: f.artworkUrl ?? "",
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

export default function PolarisEpisodeEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const itemQ = useQuery({
    queryKey: ["admin-polaris-episode", id],
    queryFn: () => api.adminGetPolarisEpisode(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
    qc.invalidateQueries({ queryKey: ["admin-polaris-episodes"] });
    qc.invalidateQueries({ queryKey: ["admin-polaris-episode", id] });
    qc.invalidateQueries({ queryKey: ["polaris-episodes"] });
  };

  const createMut = useMutation({
    mutationFn: (body: PolarisEpisodeInput) => api.createPolarisEpisode(body),
    onSuccess: (created) => {
      toast({ title: "Episode created" });
      invalidate();
      navigate(`/library/polaris-episodes/${created.id}/edit`);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: PolarisEpisodeInput) => api.updatePolarisEpisode(id!, body),
    onSuccess: () => {
      toast({ title: "Episode saved" });
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
    if (form.episodeNumber === "" || Number.isNaN(Number(form.episodeNumber))) {
      toast({ title: "Episode number is required", variant: "destructive" });
      return;
    }
    const body = toBody(form);
    if (id) updateMut.mutate(body);
    else createMut.mutate(body);
  };

  if (!isNew && itemQ.isLoading && !loaded) {
    return (
      <AdminLayout title="Edit Episode">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New Polaris Episode" : `Edit: ${itemQ.data?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Polaris", href: "/library/polaris-episodes" },
        { label: isNew ? "New" : itemQ.data?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/library/polaris-episodes")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-polaris"
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
          You have read-only access. Only editors and admins can change episodes.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4 min-w-0">
          <Card className="p-4 space-y-4">
            <div className="grid grid-cols-[100px_1fr] gap-4">
              <div>
                <Label htmlFor="episodeNumber">Episode #</Label>
                <Input
                  id="episodeNumber"
                  type="number"
                  value={form.episodeNumber}
                  onChange={(e) => update({ episodeNumber: e.target.value })}
                  disabled={!canWrite}
                  data-testid="input-polaris-number"
                />
              </div>
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value })}
                  disabled={!canWrite}
                  data-testid="input-polaris-title"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/polaris/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="summary">Summary</Label>
              <Textarea
                id="summary"
                value={form.summary}
                onChange={(e) => update({ summary: e.target.value })}
                disabled={!canWrite}
                rows={5}
                data-testid="input-polaris-summary"
              />
            </div>
            <div>
              <Label htmlFor="guestName">Guest</Label>
              <Input
                id="guestName"
                value={form.guestName}
                onChange={(e) => update({ guestName: e.target.value })}
                disabled={!canWrite}
                placeholder="e.g. Glenn Poulos"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Audio &amp; distribution
            </h3>
            <div>
              <Label htmlFor="audioUrl">Audio URL (MP3)</Label>
              <Input
                id="audioUrl"
                value={form.audioUrl}
                onChange={(e) => update({ audioUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="https://traffic.libsyn.com/..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="appleUrl">Apple Podcasts URL</Label>
                <Input
                  id="appleUrl"
                  value={form.appleUrl}
                  onChange={(e) => update({ appleUrl: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="spotifyUrl">Spotify URL</Label>
                <Input
                  id="spotifyUrl"
                  value={form.spotifyUrl}
                  onChange={(e) => update({ spotifyUrl: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="durationSeconds">Duration (seconds)</Label>
              <Input
                id="durationSeconds"
                type="number"
                value={form.durationSeconds}
                onChange={(e) => update({ durationSeconds: e.target.value })}
                disabled={!canWrite}
                placeholder="e.g. 960 for 16 min"
              />
            </div>
            <div>
              <Label htmlFor="transcriptHtml">Transcript (HTML)</Label>
              <Textarea
                id="transcriptHtml"
                value={form.transcriptHtml}
                onChange={(e) => update({ transcriptHtml: e.target.value })}
                disabled={!canWrite}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Publishing
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => update({ status: v as ArtifactStatus })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="status" data-testid="select-polaris-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
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
                data-testid="switch-polaris-active"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Featured</Label>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => update({ featured: v })}
                disabled={!canWrite}
                data-testid="switch-polaris-featured"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Artwork</Label>
            <div className="aspect-square w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {form.artworkUrl ? (
                <img src={form.artworkUrl} alt="Artwork" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <Input
              value={form.artworkUrl}
              onChange={(e) => update({ artworkUrl: e.target.value })}
              disabled={!canWrite}
              placeholder="Image URL (1400x1400 square)"
            />
          </Card>

          {!isNew && (
            <Card className="p-4">
              <TaxonomyPicker
                entityType="polaris_episode"
                entityId={id ?? null}
                canWrite={canWrite}
              />
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
    </AdminLayout>
  );
}
