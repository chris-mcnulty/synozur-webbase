import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, X, Image as ImageIcon } from "lucide-react";
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
import {
  useCmsListServices,
  useCmsListSolutions,
  useCmsCreateSolution,
  useCmsUpdateSolution,
  type Service,
  type Solution,
  type UpsertSolutionBody,
  type MediaItem,
} from "@workspace/api-client-react";

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
        navigate(`/admin/solutions/${s.id}/edit`);
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
        { label: "Admin", href: "/admin" },
        { label: "Solutions", href: "/admin/solutions" },
        { label: isNew ? "New" : existing?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/admin/solutions")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
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
        </div>

        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
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

      <MediaPickerModal
        open={showIconPicker}
        onClose={() => setShowIconPicker(false)}
        onSelect={handleIcon}
        selectedId={form.iconId}
        title="Choose solution icon"
      />
    </AdminLayout>
  );
}
