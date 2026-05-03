import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Image as ImageIcon,
  ExternalLink,
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
import { ActivityTab } from "@/components/admin/ActivityTab";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  MediaPickerModal,
  mediaUrl,
} from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  type ApplicationDto,
  type ArtifactStatus,
  type BookingDto,
  type ServiceWithSolutions,
} from "@/lib/api";
import type { MediaItem } from "@workspace/api-client-react";

interface Props {
  id?: string;
}

const STATUS_OPTIONS: { value: ArtifactStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
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
  name: string;
  tagline: string;
  shortSummary: string;
  description: string[];
  version: string;
  releaseDate: string;
  websiteUrl: string;
  userGuideUrl: string;
  logo: string | null;
  logoUrl: string | null;
  screenshot: string | null;
  screenshotUrl: string | null;
  showInNav: boolean;
  serviceId: string;
  solutionId: string;
  bookingId: string;
  status: ArtifactStatus;
  publishedAt: string;
  unpublishedAt: string;
  featured: boolean;
  featuredRank: string;
  seoTitle: string;
  seoDescription: string;
  active: boolean;
  sourceId: string;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  name: "",
  tagline: "",
  shortSummary: "",
  description: [""],
  version: "",
  releaseDate: "",
  websiteUrl: "",
  userGuideUrl: "",
  logo: null,
  logoUrl: null,
  screenshot: null,
  screenshotUrl: null,
  showInNav: true,
  serviceId: "",
  solutionId: "",
  bookingId: "",
  status: "published",
  publishedAt: "",
  unpublishedAt: "",
  featured: false,
  featuredRank: "",
  seoTitle: "",
  seoDescription: "",
  active: true,
  sourceId: "",
};

function fromDto(a: ApplicationDto): FormState {
  return {
    title: a.title,
    slug: a.slug,
    name: a.name,
    tagline: a.tagline,
    shortSummary: a.shortSummary,
    description: a.description.length > 0 ? a.description : [""],
    version: a.version ?? "",
    releaseDate: a.releaseDate ?? "",
    websiteUrl: a.websiteUrl,
    userGuideUrl: a.userGuideUrl ?? "",
    logo: a.logo || null,
    logoUrl: a.logo || null,
    screenshot: a.screenshot || null,
    screenshotUrl: a.screenshot || null,
    showInNav: a.showInNav,
    serviceId: a.serviceId ?? "",
    solutionId: a.solutionId ?? "",
    bookingId: a.bookingId ?? "",
    status: (a.status ?? "draft") as ArtifactStatus,
    publishedAt: toDatetimeLocal(a.publishedAt),
    unpublishedAt: toDatetimeLocal(a.unpublishedAt),
    featured: a.featured,
    featuredRank: a.featuredRank != null ? String(a.featuredRank) : "",
    seoTitle: a.seoTitle ?? "",
    seoDescription: a.seoDescription ?? "",
    active: a.active,
    sourceId: a.sourceId ?? "",
  };
}

export default function ApplicationEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const fetchQ = useQuery({
    queryKey: ["admin-application", id],
    queryFn: () => api.adminGetApplication(id!),
    enabled: !!id,
  });
  const existing: ApplicationDto | null = fetchQ.data ?? null;

  const servicesQ = useQuery({
    queryKey: ["admin-services-with-solutions"],
    queryFn: () => api.listServicesAdmin(),
  });
  const allServices: ServiceWithSolutions[] = servicesQ.data?.items ?? [];
  const bookingsQ = useQuery({ queryKey: ["admin-bookings"], queryFn: () => api.adminListBookings() });
  const allBookings: BookingDto[] = bookingsQ.data?.items ?? [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [showScreenshotPicker, setShowScreenshotPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const selectedService = allServices.find((s) => s.id === form.serviceId) ?? null;
  const availableSolutions = selectedService?.solutions ?? [];

  const selectableBookings: BookingDto[] = allBookings.filter((b) => {
    if (b.id === form.bookingId) return true;
    if (!b.active) return false;
    if (b.endsAt && new Date(b.endsAt) <= new Date()) return false;
    return true;
  });
  const isStaleSelection = (b: BookingDto): boolean =>
    !b.active || (!!b.endsAt && new Date(b.endsAt) <= new Date());

  useEffect(() => {
    if (existing && !loaded) {
      setForm(fromDto(existing));
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

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof api.createApplication>[0]) =>
      api.createApplication(data),
    onSuccess: (a) => {
      toast({ title: "Application created" });
      qc.invalidateQueries({ queryKey: ["admin-applications"] });
      navigate(`/applications/${a.id}/edit`);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ appId, data }: { appId: string; data: Parameters<typeof api.updateApplication>[1] }) =>
      api.updateApplication(appId, data),
    onSuccess: () => {
      toast({ title: "Application saved" });
      qc.invalidateQueries({ queryKey: ["admin-applications"] });
      qc.invalidateQueries({ queryKey: ["admin-application", id] });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const buildBody = () => ({
    title: form.title,
    slug: form.slug || undefined,
    name: form.name || form.title,
    tagline: form.tagline || undefined,
    shortSummary: form.shortSummary || undefined,
    description: form.description.filter((p) => p.trim() !== ""),
    version: form.version || null,
    releaseDate: form.releaseDate || null,
    websiteUrl: form.websiteUrl || undefined,
    logo: form.logo || undefined,
    screenshot: form.screenshot || undefined,
    userGuideUrl: form.userGuideUrl || null,
    showInNav: form.showInNav,
    serviceId: form.serviceId || null,
    solutionId: form.solutionId || null,
    bookingId: form.bookingId || null,
    status: form.status,
    publishedAt: fromDatetimeLocal(form.publishedAt),
    unpublishedAt: fromDatetimeLocal(form.unpublishedAt),
    featured: form.featured,
    featuredRank: form.featuredRank === "" ? null : Number(form.featuredRank),
    seoTitle: form.seoTitle || null,
    seoDescription: form.seoDescription || null,
    active: form.active,
    sourceId: form.sourceId || null,
  });

  const onSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (id) {
      await updateMut.mutateAsync({ appId: id, data: buildBody() });
    } else {
      await createMut.mutateAsync(buildBody());
    }
  };

  const handleLogo = (m: MediaItem) => {
    update({ logo: mediaUrl(m), logoUrl: mediaUrl(m) });
    setShowLogoPicker(false);
  };

  const handleScreenshot = (m: MediaItem) => {
    update({ screenshot: mediaUrl(m), screenshotUrl: mediaUrl(m) });
    setShowScreenshotPicker(false);
  };

  const addParagraph = () => update({ description: [...form.description, ""] });
  const removeParagraph = (i: number) =>
    update({ description: form.description.filter((_, idx) => idx !== i) });
  const updateParagraph = (i: number, value: string) => {
    const next = [...form.description];
    next[i] = value;
    update({ description: next });
  };

  const isSaving = createMut.isPending || updateMut.isPending;

  if (!isNew && fetchQ.isLoading) {
    return (
      <AdminLayout title="Edit Application">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New Application" : `Edit: ${existing?.name ?? existing?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Applications", href: "/applications" },
        { label: isNew ? "New" : existing?.name ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/applications")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {!isNew && existing?.websiteUrl && (
            <a
              href={existing.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" /> Website
              </Button>
            </a>
          )}
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={isSaving}
              data-testid="button-save-application"
            >
              <Save className="h-4 w-4 mr-1" />
              {isSaving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      }
    >
      {!canWrite && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          You have read-only access. Only editors and admins can change applications.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4 min-w-0">
          {/* Identity */}
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="title">Title (internal)</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                disabled={!canWrite}
                className="text-xl font-semibold h-11"
                data-testid="input-application-title"
              />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/applications/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-application-slug"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                disabled={!canWrite}
                placeholder="Shown on public pages"
              />
            </div>
            <div>
              <Label htmlFor="tagline">Tagline</Label>
              <Input
                id="tagline"
                value={form.tagline}
                onChange={(e) => update({ tagline: e.target.value })}
                disabled={!canWrite}
                placeholder="Short one-line description"
              />
            </div>
            <div>
              <Label htmlFor="shortSummary">Short summary</Label>
              <Textarea
                id="shortSummary"
                value={form.shortSummary}
                onChange={(e) => update({ shortSummary: e.target.value })}
                disabled={!canWrite}
                rows={3}
                placeholder="1–2 sentences for list and card views"
              />
            </div>
          </Card>

          {/* Description paragraphs */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Description paragraphs</Label>
              {canWrite && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addParagraph}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add paragraph
                </Button>
              )}
            </div>
            {form.description.map((para, i) => (
              <div key={i} className="flex gap-2">
                <Textarea
                  value={para}
                  onChange={(e) => updateParagraph(i, e.target.value)}
                  disabled={!canWrite}
                  rows={3}
                  placeholder={`Paragraph ${i + 1}`}
                  className="flex-1"
                />
                {canWrite && form.description.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeParagraph(i)}
                    className="mt-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </Card>

          {/* Version & Links */}
          <Card className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={form.version}
                  onChange={(e) => update({ version: e.target.value })}
                  disabled={!canWrite}
                  placeholder="e.g. v2.1.0"
                />
              </div>
              <div>
                <Label htmlFor="releaseDate">Release date</Label>
                <Input
                  id="releaseDate"
                  type="date"
                  value={form.releaseDate}
                  onChange={(e) => update({ releaseDate: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="websiteUrl">Website URL</Label>
              <Input
                id="websiteUrl"
                value={form.websiteUrl}
                onChange={(e) => update({ websiteUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="https://…"
              />
            </div>
            <div>
              <Label htmlFor="userGuideUrl">User guide URL</Label>
              <Input
                id="userGuideUrl"
                value={form.userGuideUrl}
                onChange={(e) => update({ userGuideUrl: e.target.value })}
                disabled={!canWrite}
                placeholder="https://docs.…"
              />
            </div>
            <div>
              <Label htmlFor="sourceId">Source ID</Label>
              <Input
                id="sourceId"
                value={form.sourceId}
                onChange={(e) => update({ sourceId: e.target.value })}
                disabled={!canWrite}
                placeholder="External sync identifier"
              />
            </div>
          </Card>

          {/* Media */}
          <Card className="p-4 space-y-4">
            <Label className="text-sm font-medium">Media</Label>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Logo</Label>
                <div className="w-24 h-24 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
                  {form.logoUrl ? (
                    <img
                      src={form.logoUrl}
                      alt="Logo"
                      className="h-full w-full object-contain p-1"
                    />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                {canWrite && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowLogoPicker(true)}
                    >
                      {form.logoUrl ? "Change" : "Pick logo"}
                    </Button>
                    {form.logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update({ logo: null, logoUrl: null })}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Screenshot</Label>
                <div className="w-full h-28 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
                  {form.screenshotUrl ? (
                    <img
                      src={form.screenshotUrl}
                      alt="Screenshot"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                {canWrite && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowScreenshotPicker(true)}
                    >
                      {form.screenshotUrl ? "Change" : "Pick screenshot"}
                    </Button>
                    {form.screenshotUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          update({ screenshot: null, screenshotUrl: null })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* SEO */}
          <Card className="p-4 space-y-3">
            <div>
              <Label className="text-sm font-medium">SEO</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Overrides the page title and meta description on the public detail
                page. Leave blank to use the name and short summary.
              </p>
            </div>
            <div>
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input
                id="seoTitle"
                value={form.seoTitle}
                maxLength={70}
                placeholder="e.g. Vega — The AI-Powered Company OS | Synozur"
                onChange={(e) => update({ seoTitle: e.target.value })}
                disabled={!canWrite}
                data-testid="input-application-seo-title"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {form.seoTitle.length}/70 characters — Google typically truncates past ~60.
              </div>
            </div>
            <div>
              <Label htmlFor="seoDescription">SEO description</Label>
              <textarea
                id="seoDescription"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                maxLength={300}
                value={form.seoDescription}
                onChange={(e) => update({ seoDescription: e.target.value })}
                disabled={!canWrite}
                data-testid="input-application-seo-description"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {form.seoDescription.length}/300 characters — aim for 150–160.
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Publish status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => update({ status: v as ArtifactStatus })}
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="select-application-status">
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
                data-testid="switch-application-active"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Visibility</Label>
            <div className="flex items-center justify-between">
              <span className="text-sm">Featured</span>
              <Switch
                checked={form.featured}
                onCheckedChange={(v) => update({ featured: v })}
                disabled={!canWrite}
                data-testid="switch-application-featured"
              />
            </div>
            <div>
              <Label htmlFor="featuredRank" className="text-xs">
                Featured rank
              </Label>
              <Input
                id="featuredRank"
                type="number"
                value={form.featuredRank}
                onChange={(e) => update({ featuredRank: e.target.value })}
                disabled={!canWrite}
                placeholder="Lower = higher priority"
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <span className="text-sm">Show in nav</span>
              <Switch
                checked={form.showInNav}
                onCheckedChange={(v) => update({ showInNav: v })}
                disabled={!canWrite}
                data-testid="switch-application-show-in-nav"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Linking</Label>
            <div className="space-y-1">
              <Label htmlFor="serviceId" className="text-xs">
                Service
              </Label>
              <Select
                value={form.serviceId || "__none__"}
                onValueChange={(v) => {
                  const next = v === "__none__" ? "" : v;
                  update({ serviceId: next, solutionId: "" });
                }}
                disabled={!canWrite}
              >
                <SelectTrigger id="serviceId" data-testid="select-service">
                  <SelectValue placeholder="No service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No service</SelectItem>
                  {allServices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="solutionId" className="text-xs">
                Solution
              </Label>
              <Select
                value={form.solutionId || "__none__"}
                onValueChange={(v) =>
                  update({ solutionId: v === "__none__" ? "" : v })
                }
                disabled={!canWrite || availableSolutions.length === 0}
              >
                <SelectTrigger id="solutionId" data-testid="select-solution">
                  <SelectValue
                    placeholder={
                      form.serviceId
                        ? availableSolutions.length === 0
                          ? "No solutions"
                          : "No solution"
                        : "Select a service first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No solution</SelectItem>
                  {availableSolutions.map((sol) => (
                    <SelectItem key={sol.id} value={sol.id}>
                      {sol.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Booking</Label>
            <p className="text-xs text-muted-foreground">
              Optionally attach a Bookings card shown on this page.
            </p>
            <Select
              value={form.bookingId || "__none__"}
              onValueChange={(v) => update({ bookingId: v === "__none__" ? "" : v })}
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="select-application-booking">
                <SelectValue placeholder="No booking" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No booking</SelectItem>
                {selectableBookings.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title}
                    {isStaleSelection(b) ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>
        </aside>
      </div>

      {showLogoPicker && (
        <MediaPickerModal
          open
          onClose={() => setShowLogoPicker(false)}
          onSelect={handleLogo}
        />
      )}
      {showScreenshotPicker && (
        <MediaPickerModal
          open
          onClose={() => setShowScreenshotPicker(false)}
          onSelect={handleScreenshot}
        />
      )}
      <div className="mt-6">
        <ActivityTab entity="application" entityId={id} />
      </div>
    </AdminLayout>
  );
}
