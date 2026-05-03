import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save, X, Image as ImageIcon, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import {
  MediaPickerModal,
  mediaUrl,
  uploadAndRegisterImage,
} from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import { api, type ArtifactStatus, type BookingDto } from "@/lib/api";
import { RevisionsPanel } from "@/components/admin/RevisionsPanel";
import {
  useCmsListServices,
  useCmsCreateService,
  useCmsUpdateService,
  useListCmsTags,
  type Service,
  type UpsertServiceBody,
  type MediaItem,
} from "@workspace/api-client-react";

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
  servicePath: string;
  overviewPath: string;
  buttonText: string;
  heroTextHtml: string;
  secondaryTitle: string;
  secondaryTextHtml: string;
  tertiaryTitle: string;
  tertiaryTextHtml: string;
  blurbHtml: string;
  blogCategory: string;
  seoTitle: string;
  seoDescription: string;
  status: ArtifactStatus;
  publishedAt: string;
  unpublishedAt: string;
  tagIds: string[];
  bookingId: string;
  active: boolean;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  displayOrder: "",
  parentServiceId: "",
  iconId: null,
  iconUrl: null,
  servicePath: "",
  overviewPath: "",
  buttonText: "",
  heroTextHtml: "",
  secondaryTitle: "",
  secondaryTextHtml: "",
  tertiaryTitle: "",
  tertiaryTextHtml: "",
  blurbHtml: "",
  blogCategory: "",
  seoTitle: "",
  seoDescription: "",
  status: "published",
  publishedAt: "",
  unpublishedAt: "",
  tagIds: [],
  bookingId: "",
  active: true,
};

function fromService(s: Service): FormState {
  return {
    title: s.title,
    slug: s.slug,
    displayOrder: s.displayOrder == null ? "" : String(s.displayOrder),
    parentServiceId: s.parentServiceId ?? "",
    iconId: s.iconId ?? null,
    iconUrl: s.iconUrl ?? null,
    servicePath: s.servicePath ?? "",
    overviewPath: s.overviewPath ?? "",
    buttonText: s.buttonText ?? "",
    heroTextHtml: s.heroTextHtml ?? "",
    secondaryTitle: s.secondaryTitle ?? "",
    secondaryTextHtml: s.secondaryTextHtml ?? "",
    tertiaryTitle: s.tertiaryTitle ?? "",
    tertiaryTextHtml: s.tertiaryTextHtml ?? "",
    blurbHtml: s.blurbHtml ?? "",
    blogCategory: s.blogCategory ?? "",
    seoTitle: s.seoTitle ?? "",
    seoDescription: s.seoDescription ?? "",
    status: (s.status ?? "draft") as ArtifactStatus,
    publishedAt: toDatetimeLocal(s.publishedAt),
    unpublishedAt: toDatetimeLocal(s.unpublishedAt),
    tagIds: (s.tags ?? []).map((t) => t.id),
    bookingId: s.bookingId ?? "",
    active: s.active,
  };
}

function toBody(f: FormState): UpsertServiceBody {
  return {
    title: f.title,
    slug: f.slug || null,
    displayOrder: f.displayOrder === "" ? null : Number(f.displayOrder),
    parentServiceId: f.parentServiceId || null,
    iconId: f.iconId,
    servicePath: f.servicePath || null,
    overviewPath: f.overviewPath || null,
    buttonText: f.buttonText || null,
    heroTextHtml: f.heroTextHtml || null,
    secondaryTitle: f.secondaryTitle || null,
    secondaryTextHtml: f.secondaryTextHtml || null,
    tertiaryTitle: f.tertiaryTitle || null,
    tertiaryTextHtml: f.tertiaryTextHtml || null,
    blurbHtml: f.blurbHtml || null,
    blogCategory: f.blogCategory || null,
    seoTitle: f.seoTitle || null,
    seoDescription: f.seoDescription || null,
    status: f.status,
    publishedAt: fromDatetimeLocal(f.publishedAt),
    unpublishedAt: fromDatetimeLocal(f.unpublishedAt),
    tagIds: f.tagIds,
    bookingId: f.bookingId || null,
    active: f.active,
  };
}

export default function ServiceEdit({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;
  const canWrite = !!access?.isEditorOrAbove;

  const servicesQ = useCmsListServices();
  const allServices: Service[] = (servicesQ.data?.items ?? []) as Service[];
  const existing = id ? allServices.find((s) => s.id === id) ?? null : null;
  const tagsQ = useListCmsTags();
  const allTags = (tagsQ.data ?? []) as { id: string; slug: string; name: string }[];
  const bookingsQ = useQuery({ queryKey: ["admin-bookings"], queryFn: () => api.adminListBookings() });
  const allBookings: BookingDto[] = bookingsQ.data?.items ?? [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
      setForm(fromService(existing));
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

  const createMut = useCmsCreateService({
    mutation: {
      onSuccess: (s) => {
        toast({ title: "Service created" });
        qc.invalidateQueries({ queryKey: ["/api/cms/services"] });
        navigate(`/products/services/${s.id}/edit`);
      },
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateMut = useCmsUpdateService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service saved" });
        qc.invalidateQueries({ queryKey: ["/api/cms/services"] });
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

  // #60: save any pending changes first, mint a 24 h preview token, then
  // pop the public detail page in a new tab. We always save first so the
  // preview reflects what the editor sees in the form.
  const [previewPending, setPreviewPending] = useState(false);
  const onPreview = async () => {
    if (!id) {
      toast({
        title: "Save first",
        description: "Create the service before previewing.",
        variant: "destructive",
      });
      return;
    }
    setPreviewPending(true);
    try {
      await updateMut.mutateAsync({ id, data: toBody(form) });
      const { previewPath } = await api.createServicePreviewToken(id);
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

  const parentChoices = allServices.filter((s) => !id || s.id !== id);

  if (!isNew && servicesQ.isLoading && !existing) {
    return (
      <AdminLayout title="Edit Service">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={isNew ? "New Service" : `Edit: ${existing?.title ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Services", href: "/products/services" },
        { label: isNew ? "New" : existing?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/products/services")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {canWrite && !isNew && (
            <Button
              variant="outline"
              onClick={onPreview}
              disabled={previewPending || updateMut.isPending}
              data-testid="button-preview-service"
            >
              <Eye className="h-4 w-4 mr-1" />
              {previewPending ? "Opening…" : "Preview"}
            </Button>
          )}
          {canWrite && (
            <Button
              onClick={onSave}
              disabled={createMut.isPending || updateMut.isPending}
              data-testid="button-save-service"
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
          You have read-only access. Only editors and admins can change services.
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
                data-testid="input-service-title"
                className="text-xl font-semibold h-11"
              />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/services/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  disabled={!canWrite}
                  data-testid="input-service-slug"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="displayOrder">Display order</Label>
                <Input
                  id="displayOrder"
                  type="number"
                  value={form.displayOrder}
                  onChange={(e) => update({ displayOrder: e.target.value })}
                  disabled={!canWrite}
                  data-testid="input-service-display-order"
                />
              </div>
              <div>
                <Label htmlFor="parent">Parent service</Label>
                <Select
                  value={form.parentServiceId || "__none__"}
                  onValueChange={(v) => update({ parentServiceId: v === "__none__" ? "" : v })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="parent" data-testid="select-service-parent">
                    <SelectValue placeholder="None (top-level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (top-level)</SelectItem>
                    {parentChoices.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="servicePath">Service path</Label>
                <Input
                  id="servicePath"
                  value={form.servicePath}
                  onChange={(e) => update({ servicePath: e.target.value })}
                  disabled={!canWrite}
                  placeholder="/services/strategic-transformation"
                />
              </div>
              <div>
                <Label htmlFor="overviewPath">Overview path</Label>
                <Input
                  id="overviewPath"
                  value={form.overviewPath}
                  onChange={(e) => update({ overviewPath: e.target.value })}
                  disabled={!canWrite}
                  placeholder="/services-overview/default"
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
                <Label htmlFor="blogCategory">Blog category</Label>
                <Input
                  id="blogCategory"
                  value={form.blogCategory}
                  onChange={(e) => update({ blogCategory: e.target.value })}
                  disabled={!canWrite}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <Label>Hero text</Label>
            <RichTextEditor
              value={form.heroTextHtml}
              onChange={({ html }) => update({ heroTextHtml: html })}
              onUploadImage={uploadAndRegisterImage}
            />
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
              <Label htmlFor="tertiaryTitle">Tertiary title</Label>
              <Input
                id="tertiaryTitle"
                value={form.tertiaryTitle}
                onChange={(e) => update({ tertiaryTitle: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label>Tertiary text</Label>
              <RichTextEditor
                value={form.tertiaryTextHtml}
                onChange={({ html }) => update({ tertiaryTextHtml: html })}
                onUploadImage={uploadAndRegisterImage}
              />
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <Label>Blurb</Label>
            <RichTextEditor
              value={form.blurbHtml}
              onChange={({ html }) => update({ blurbHtml: html })}
              onUploadImage={uploadAndRegisterImage}
            />
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label className="text-sm font-medium">SEO</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Overrides the page title and meta description on this service's
                public detail page. Leave blank to use the title and blurb.
              </p>
            </div>
            <div>
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input
                id="seoTitle"
                value={form.seoTitle}
                maxLength={70}
                placeholder="e.g. Strategic Transformation Services | Synozur"
                onChange={(e) => update({ seoTitle: e.target.value })}
                disabled={!canWrite}
                data-testid="input-service-seo-title"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {form.seoTitle.length}/70 characters — Google typically
                truncates past ~60.
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
                data-testid="input-service-seo-description"
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
              <SelectTrigger data-testid="select-service-status">
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
                data-testid="switch-service-active"
              />
            </div>
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
            <Label className="text-sm font-medium">Booking</Label>
            <p className="text-xs text-muted-foreground">
              Optionally attach a Bookings card shown on this page.
            </p>
            <Select
              value={form.bookingId || "__none__"}
              onValueChange={(v) => update({ bookingId: v === "__none__" ? "" : v })}
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="select-service-booking">
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
                  data-testid="button-pick-service-icon"
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
          kind="service"
          id={id}
          invalidateKeys={[["/api/cms/services"]]}
        />
      )}

      <MediaPickerModal
        open={showIconPicker}
        onClose={() => setShowIconPicker(false)}
        onSelect={handleIcon}
        selectedId={form.iconId}
        title="Choose service icon"
        categorySlug="service-icon"
      />
      <div className="mt-6">
        <ActivityTab entity="service" entityId={id} />
      </div>
    </AdminLayout>
  );
}
