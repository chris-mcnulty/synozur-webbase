import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Eye,
  Send,
  Calendar,
  Archive,
  Image as ImageIcon,
  X,
  Plus,
  History,
  Star,
  GitCompare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { OgImagePreview } from "@/components/admin/OgImagePreview";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { MediaPickerModal, mediaUrl, uploadAndRegisterImage } from "@/components/admin/MediaPickerModal";
import { CollateralSolutionsEditor } from "@/components/admin/CollateralSolutionsEditor";
import { sanitizeHtml } from "@/components/rich-text";
import { useToast } from "@/hooks/use-toast";
import { api, type PostRevisionDetail } from "@/lib/api";
import {
  useCreateCmsPost,
  useGetCmsPost,
  useUpdateCmsPost,
  usePublishCmsPost,
  useScheduleCmsPost,
  useArchiveCmsPost,
  useListCmsCategories,
  useListCmsTags,
  useCreateCmsTag,
  useCmsListSolutions,
  useListCmsPostRevisions,
  useRestoreCmsPostRevision,
  getListCmsPostRevisionsQueryKey,
  type CreatePostBody,
  type Post,
  type PostRevision,
  type Tag,
  type Category,
  type MediaItem,
} from "@workspace/api-client-react";

interface Props {
  id?: string;
}

function toLocalDateTime(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface FormState {
  title: string;
  slug: string;
  subtitle: string;
  excerpt: string;
  bodyHtml: string;
  bodyMarkdown: string;
  heroImageId: string | null;
  heroImageUrl: string | null;
  heroImageChanged: boolean;
  ogImageId: string | null;
  ogImageUrl: string | null;
  ogImageChanged: boolean;
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
  featured: boolean;
  featuredRank: string;
  categoryIds: string[];
  tagIds: string[];
  linkedSolutionId: string | null;
  authorId: string;
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  subtitle: "",
  excerpt: "",
  bodyHtml: "",
  bodyMarkdown: "",
  heroImageId: null,
  heroImageUrl: null,
  heroImageChanged: false,
  ogImageId: null,
  ogImageUrl: null,
  ogImageChanged: false,
  seoTitle: "",
  seoDescription: "",
  seoCanonicalUrl: "",
  featured: false,
  featuredRank: "",
  categoryIds: [],
  tagIds: [],
  linkedSolutionId: null,
  authorId: "",
};

function fromPost(p: Post): FormState {
  return {
    title: p.title,
    slug: p.slug,
    subtitle: p.subtitle ?? "",
    excerpt: p.excerpt ?? "",
    bodyHtml: p.bodyHtml ?? "",
    bodyMarkdown: p.bodyMarkdown ?? "",
    heroImageId: null,
    heroImageUrl: p.heroImageUrl ?? null,
    heroImageChanged: false,
    ogImageId: null,
    ogImageUrl: p.ogImageUrl ?? null,
    ogImageChanged: false,
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    seoCanonicalUrl: p.seoCanonicalUrl ?? "",
    featured: p.featured ?? false,
    featuredRank: p.featuredRank != null ? String(p.featuredRank) : "",
    categoryIds: (p.categories ?? []).map((c) => c.id),
    tagIds: (p.tags ?? []).map((t) => t.id),
    linkedSolutionId: p.linkedSolutionId ?? null,
    authorId: p.author?.id ?? "",
  };
}

function toBody(state: FormState): CreatePostBody & { authorId?: string } {
  return {
    title: state.title,
    slug: state.slug || null,
    subtitle: state.subtitle || null,
    excerpt: state.excerpt || null,
    bodyHtml: state.bodyHtml || null,
    bodyMarkdown: state.bodyMarkdown || null,
    // Only send image IDs when the user explicitly picked or cleared an image
    // in this editing session. Omitting them (undefined) leaves the server-side
    // value untouched, preventing fromPost()'s null reset from wiping the DB.
    heroImageId: state.heroImageChanged ? state.heroImageId : undefined,
    ogImageId: state.ogImageChanged ? state.ogImageId : undefined,
    seoTitle: state.seoTitle || null,
    seoDescription: state.seoDescription || null,
    seoCanonicalUrl: state.seoCanonicalUrl || null,
    featured: state.featured,
    featuredRank:
      state.featured && state.featuredRank.trim()
        ? Number(state.featuredRank)
        : null,
    categoryIds: state.categoryIds,
    tagIds: state.tagIds,
    linkedSolutionId: state.linkedSolutionId,
    authorId: state.authorId || undefined,
  };
}

export default function PostEditor({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { access } = useAdminAccess();
  const isNew = !id;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [showOgPicker, setShowOgPicker] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [showHistory, setShowHistory] = useState(false);
  const [postId, setPostId] = useState<string | null>(id ?? null);

  const { data: existing, isLoading: loadingExisting } = useGetCmsPost(postId ?? "", {
    query: { enabled: !!postId } as never,
  });

  const cats = useListCmsCategories();
  const tags = useListCmsTags();
  const { data: solutionsData } = useCmsListSolutions({});
  const canManageAuthor = !!access?.isEditorOrAbove;
  const { data: users } = useQuery({
    queryKey: ["/api/cms/users"],
    queryFn: async () => {
      const r = await fetch(`${BASE_PATH}/api/cms/users`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json() as Promise<Array<{ id: string; displayName: string; email: string; avatarUrl: string | null }>>;
    },
    enabled: canManageAuthor,
  });

  useEffect(() => {
    if (existing) {
      setForm(fromPost(existing));
      setSavedAt(new Date(existing.updatedAt));
      setDirty(false);
      setSlugTouched(true);
      setScheduleDate(
        existing.scheduledFor
          ? toLocalDateTime(existing.scheduledFor)
          : existing.publishedAt
            ? toLocalDateTime(existing.publishedAt)
            : "",
      );
    }
  }, [existing]);

  // Auto-slug from title for new posts
  useEffect(() => {
    if (!slugTouched && form.title) {
      setForm((f) => ({ ...f, slug: slugify(f.title) }));
    }
  }, [form.title, slugTouched]);

  const createMut = useCreateCmsPost({
    mutation: {
      onSuccess: (p) => {
        setPostId(p.id);
        setSavedAt(new Date());
        setDirty(false);
        qc.invalidateQueries({ queryKey: ["/api/cms/posts"] });
      },
      onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateMut = useUpdateCmsPost({
    mutation: {
      onSuccess: () => {
        setSavedAt(new Date());
        setDirty(false);
        qc.invalidateQueries({ queryKey: ["/api/cms/posts"] });
        if (postId) qc.invalidateQueries({ queryKey: [`/api/cms/posts/${postId}`] });
      },
      onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    },
  });
  const publishMut = usePublishCmsPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post published" });
        qc.invalidateQueries();
      },
      onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
    },
  });
  const scheduleMut = useScheduleCmsPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post scheduled" });
        qc.invalidateQueries();
      },
      onError: (e: Error) => toast({ title: "Schedule failed", description: e.message, variant: "destructive" }),
    },
  });
  const archiveMut = useArchiveCmsPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post archived" });
        qc.invalidateQueries();
        navigate("/insights/posts");
      },
      onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
    },
  });
  const createTagMut = useCreateCmsTag({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/cms/tags"] }),
    },
  });

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  }, []);

  const saveDraft = useCallback(async () => {
    if (!form.title) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (postId) {
      await updateMut.mutateAsync({ id: postId, data: toBody(form) });
    } else {
      await createMut.mutateAsync({ data: toBody(form) });
    }
  }, [form, postId, createMut, updateMut, toast]);

  // Autosave every 15s when dirty
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const i = setInterval(() => {
      if (dirtyRef.current && form.title && !createMut.isPending && !updateMut.isPending) {
        void saveDraft();
      }
    }, 15000);
    return () => clearInterval(i);
  }, [saveDraft, form.title, createMut.isPending, updateMut.isPending]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveDraft]);

  const onPublish = async () => {
    await saveDraft();
    if (postId) await publishMut.mutateAsync({ id: postId });
  };
  const onSchedule = async () => {
    if (!scheduleDate) {
      toast({ title: "Pick a date and time first", variant: "destructive" });
      return;
    }
    await saveDraft();
    if (postId) {
      await scheduleMut.mutateAsync({
        id: postId,
        data: { scheduledFor: new Date(scheduleDate).toISOString() },
      });
    }
  };
  const onArchive = async () => {
    if (!postId) return;
    if (!confirm("Archive this post? This will remove it from the public site.")) return;
    await archiveMut.mutateAsync({ id: postId });
  };

  const handleHero = (m: MediaItem) => {
    update({ heroImageId: m.id, heroImageUrl: mediaUrl(m), heroImageChanged: true });
  };
  const handleOg = (m: MediaItem) => {
    update({ ogImageId: m.id, ogImageUrl: mediaUrl(m), ogImageChanged: true });
  };

  const addTagFromInput = async () => {
    const parts = tagInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setTagInput("");
    const all = tags.data ?? [];
    const nextIds = [...form.tagIds];
    for (const name of parts) {
      const existingT = all.find((t) => t.name.toLowerCase() === name.toLowerCase());
      let tag: Tag | null = existingT ?? null;
      if (!tag) {
        const created = await createTagMut.mutateAsync({
          data: { slug: slugify(name), name },
        });
        tag = created;
      }
      if (tag && !nextIds.includes(tag.id)) {
        nextIds.push(tag.id);
      }
    }
    update({ tagIds: nextIds });
  };

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    (tags.data ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [tags.data]);

  const previewUrl = postId ? `${BASE_PATH}/admin/insights/posts/${postId}/preview` : null;

  if (!isNew && loadingExisting) {
    return (
      <AdminLayout title="Edit Post">
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  const status = existing?.status ?? "draft";
  const canPublish = !!access?.isEditorOrAbove;

  return (
    <AdminLayout
      title={isNew ? "New Post" : "Edit Post"}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Posts", href: "/insights/posts" },
        { label: isNew ? "New" : existing?.title ?? "Edit" },
      ]}
      previewEntity={{
        kind: "post",
        id: postId,
        slug: form.slug,
        isDraft: status !== "published",
      }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/insights/posts")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" data-testid="button-preview">
                <Eye className="h-4 w-4 mr-1" /> Preview
              </Button>
            </a>
          )}
          <Button
            onClick={() => void saveDraft()}
            disabled={createMut.isPending || updateMut.isPending}
            data-testid="button-save-draft"
          >
            <Save className="h-4 w-4 mr-1" />
            {createMut.isPending || updateMut.isPending ? "Saving…" : "Save draft"}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4 min-w-0">
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="Post title"
                className="text-2xl font-semibold h-12"
                data-testid="input-post-title"
              />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/insights/</span>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update({ slug: slugify(e.target.value) });
                  }}
                  data-testid="input-post-slug"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="subtitle">Subtitle</Label>
              <Input
                id="subtitle"
                value={form.subtitle}
                onChange={(e) => update({ subtitle: e.target.value })}
                data-testid="input-post-subtitle"
              />
            </div>
            <div>
              <Label htmlFor="excerpt">Excerpt</Label>
              <Textarea
                id="excerpt"
                rows={2}
                value={form.excerpt}
                onChange={(e) => update({ excerpt: e.target.value })}
                data-testid="input-post-excerpt"
              />
            </div>
          </Card>

          <Card className="p-0">
            <RichTextEditor
              value={form.bodyHtml}
              onChange={({ html, markdown }) => update({ bodyHtml: html, bodyMarkdown: markdown })}
              onUploadImage={uploadAndRegisterImage}
            />
          </Card>

          <Card className="p-4">
            <Collapsible>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between text-left" data-testid="seo-toggle">
                  <span className="font-medium">SEO</span>
                  <span className="text-xs text-muted-foreground">Click to expand</span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 mt-4">
                <div>
                  <Label htmlFor="seoTitle">SEO Title</Label>
                  <Input
                    id="seoTitle"
                    value={form.seoTitle}
                    onChange={(e) => update({ seoTitle: e.target.value })}
                    data-testid="input-seo-title"
                  />
                </div>
                <div>
                  <Label htmlFor="seoDescription">SEO Description</Label>
                  <Textarea
                    id="seoDescription"
                    rows={2}
                    value={form.seoDescription}
                    onChange={(e) => update({ seoDescription: e.target.value })}
                    data-testid="input-seo-description"
                  />
                </div>
                <div>
                  <Label htmlFor="seoCanonicalUrl">Canonical URL</Label>
                  <Input
                    id="seoCanonicalUrl"
                    value={form.seoCanonicalUrl}
                    onChange={(e) => update({ seoCanonicalUrl: e.target.value })}
                    data-testid="input-seo-canonical"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Auto-generated social share preview</Label>
                  <OgImagePreview
                    kind="insight"
                    id={postId}
                    updatedAt={existing?.updatedAt}
                    showOverrideHint
                  />
                </div>
                <div>
                  <Label>OG Image override</Label>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-24 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
                      {form.ogImageUrl ? (
                        <img src={form.ogImageUrl} alt="OG" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowOgPicker(true)} data-testid="button-pick-og">
                      Pick image
                    </Button>
                    {form.ogImageUrl && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => update({ ogImageId: null, ogImageUrl: null, ogImageChanged: true })}>
                        <X className="h-4 w-4 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {!isNew && (
            <Card className="p-4">
              <button
                onClick={() => setShowHistory((s) => !s)}
                className="flex w-full items-center justify-between text-left"
                data-testid="history-toggle"
              >
                <span className="flex items-center gap-2 font-medium">
                  <History className="h-4 w-4" /> Revision history
                </span>
                <span className="text-xs text-muted-foreground">{showHistory ? "Hide" : "Show"}</span>
              </button>
              {showHistory && (
                <RevisionsPanel
                  postId={postId!}
                  currentTitle={form.title}
                  currentExcerpt={form.excerpt}
                  currentBodyHtml={form.bodyHtml}
                />
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Status</span>
              <Badge variant="secondary" data-testid="post-status-badge">{status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground" data-testid="saved-indicator">
              {dirty
                ? "Unsaved changes"
                : savedAt
                  ? `Saved ${formatRelative(savedAt)}`
                  : "Not saved yet"}
            </div>
            <div className="space-y-2">
              <div>
                <Label htmlFor="scheduleAt" className="text-xs">Schedule for</Label>
                <Input
                  id="scheduleAt"
                  type="datetime-local"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  data-testid="input-schedule-date"
                />
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={onSchedule}
                disabled={!scheduleDate || scheduleMut.isPending}
                data-testid="button-schedule"
              >
                <Calendar className="h-4 w-4 mr-1" /> Schedule
              </Button>
              {canPublish && (
                <Button
                  className="w-full"
                  onClick={onPublish}
                  disabled={publishMut.isPending}
                  data-testid="button-publish"
                >
                  <Send className="h-4 w-4 mr-1" /> Publish now
                </Button>
              )}
              {canPublish && !isNew && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={onArchive}
                  data-testid="button-archive"
                >
                  <Archive className="h-4 w-4 mr-1" /> Archive
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="featured" className="text-sm font-medium flex items-center gap-2">
                <Star className="h-4 w-4" /> Featured
              </Label>
              <input
                id="featured"
                type="checkbox"
                checked={form.featured}
                onChange={(e) => update({ featured: e.target.checked })}
                data-testid="input-post-featured"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Featured posts flow into the library (/library) as insights and
              are eligible for the home carousel. Most posts stay on /insights
              only; leave off unless promoting.
            </p>
            {form.featured && (
              <div>
                <Label htmlFor="featuredRank" className="text-xs">
                  Rank (optional)
                </Label>
                <Input
                  id="featuredRank"
                  type="number"
                  min={1}
                  step={1}
                  value={form.featuredRank}
                  onChange={(e) => {
                    const { value } = e.target;
                    if (value === "" || /^[1-9]\d*$/.test(value)) {
                      update({ featuredRank: value });
                    }
                  }}
                  placeholder="Lower = shown first"
                  data-testid="input-post-featured-rank"
                />
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <Label htmlFor="linkedSolutionId" className="text-sm font-medium">
              Linked solution
            </Label>
            <select
              id="linkedSolutionId"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.linkedSolutionId ?? ""}
              onChange={(e) =>
                update({ linkedSolutionId: e.target.value || null })
              }
              data-testid="select-linked-solution"
            >
              <option value="">— auto-detect from tags —</option>
              {(solutionsData?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Explicitly pins this post to a solution in the collateral library.
              Leave blank to auto-detect from tag slugs.
            </p>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <p className="text-sm font-medium mb-0.5">Linked solutions</p>
              <p className="text-xs text-muted-foreground">
                Pin this post to one or more solutions. It will appear in each
                linked solution's "Related resources" section. Save the post
                first if this is a new draft.
              </p>
            </div>
            <CollateralSolutionsEditor
              sourceId={postId ? `post:${postId}` : null}
              canWrite={true}
            />
          </Card>

          <Card className="p-4 space-y-3">
            <Label className="text-sm font-medium">Hero image</Label>
            <div className="aspect-video w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {form.heroImageUrl ? (
                <img src={form.heroImageUrl} alt="Hero" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowHeroPicker(true)} data-testid="button-pick-hero">
                {form.heroImageUrl ? "Change" : "Pick image"}
              </Button>
              {form.heroImageUrl && (
                <Button variant="ghost" size="sm" onClick={() => update({ heroImageId: null, heroImageUrl: null, heroImageChanged: true })}>
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </Card>

          {canManageAuthor && (
            <Card className="p-4 space-y-2">
              <Label className="text-sm font-medium">Author</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.authorId}
                onChange={(e) => update({ authorId: e.target.value })}
                data-testid="select-author"
              >
                <option value="">— keep current author —</option>
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName || u.email}
                  </option>
                ))}
              </select>
              {form.authorId && (
                <p className="text-xs text-muted-foreground">
                  {users?.find((u) => u.id === form.authorId)?.email ?? ""}
                </p>
              )}
            </Card>
          )}

          <Card className="p-4 space-y-2">
            <Label className="text-sm font-medium">Categories</Label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {(cats.data ?? []).map((c: Category) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.categoryIds.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        update({ categoryIds: [...form.categoryIds, c.id] });
                      } else {
                        update({
                          categoryIds: form.categoryIds.filter((x) => x !== c.id),
                        });
                      }
                    }}
                    data-testid={`category-${c.slug}`}
                  />
                  {c.name}
                </label>
              ))}
              {(cats.data ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No categories yet.</p>
              )}
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <Label className="text-sm font-medium">Tags</Label>
            <div className="flex flex-wrap gap-1">
              {form.tagIds.map((id) => {
                const t = tagsById.get(id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1" data-testid={`tag-chip-${id}`}>
                    {t?.name ?? id}
                    <button
                      onClick={() => update({ tagIds: form.tagIds.filter((x) => x !== id) })}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
            <div className="flex gap-1">
              <Input
                placeholder="Add tag… (comma-separate multiple)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    void addTagFromInput();
                  }
                }}
                data-testid="input-tag"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => void addTagFromInput()} data-testid="button-add-tag">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {(tags.data ?? [])
                .filter((t) => !form.tagIds.includes(t.id))
                .slice(0, 20)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => update({ tagIds: [...form.tagIds, t.id] })}
                    className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground"
                    data-testid={`tag-suggest-${t.slug}`}
                  >
                    + {t.name}
                  </button>
                ))}
            </div>
          </Card>
        </aside>
      </div>

      <MediaPickerModal
        open={showHeroPicker}
        onClose={() => setShowHeroPicker(false)}
        onSelect={handleHero}
        selectedId={form.heroImageId}
        title="Pick hero image"
      />
      <MediaPickerModal
        open={showOgPicker}
        onClose={() => setShowOgPicker(false)}
        onSelect={handleOg}
        selectedId={form.ogImageId}
        title="Pick OG image"
      />
      <div className="mt-6">
        <ActivityTab entity="post" entityId={id} />
      </div>
    </AdminLayout>
  );
}

function formatRelative(d: Date): string {
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return d.toLocaleString();
}

// #67: word-level diff via a simple longest-common-subsequence pass. We do
// not pull in `diff-match-patch` yet — HTML bodies in this CMS are short
// enough (sub-100k chars typical) that an O(n*m) LCS over word tokens is
// fine and keeps the bundle lean. If bodies grow, swap this for a patience
// diff or the DMP library without changing the UI.
type DiffOp = "eq" | "ins" | "del";
type DiffToken = { op: DiffOp; text: string };

function tokenize(s: string): string[] {
  // Split on whitespace but keep it so we can re-join without losing shape.
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

// Maximum number of tokens (words + whitespace) each side may have before we
// skip the O(n*m) LCS table and fall back to a simple "all-deleted / all-added"
// diff. This prevents the modal from freezing on very large revision bodies.
const DIFF_TOKEN_LIMIT = 2000;

function diffWords(a: string, b: string): DiffToken[] {
  const aw = tokenize(a);
  const bw = tokenize(b);
  const n = aw.length;
  const m = bw.length;

  // Hard cap: fall back for very large inputs to avoid O(n*m) memory spike.
  if (n > DIFF_TOKEN_LIMIT || m > DIFF_TOKEN_LIMIT) {
    return [
      {
        op: "eq" as const,
        text: "[Diff omitted — content is too large to compare in the browser. Use the Preview tab to view the revision.]",
      },
    ];
  }

  // LCS table — safe for token counts up to DIFF_TOKEN_LIMIT on each side.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aw[i] === bw[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aw[i] === bw[j]) {
      out.push({ op: "eq", text: aw[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "del", text: aw[i] });
      i++;
    } else {
      out.push({ op: "ins", text: bw[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ op: "del", text: aw[i++] });
  }
  while (j < m) {
    out.push({ op: "ins", text: bw[j++] });
  }
  return out;
}

// Strip HTML tags for diffing. Diffing raw HTML produces noise when only
// attributes or structure moves; comparing the readable text surfaces the
// edits that actually matter to editors.
function htmlToText(html: string): string {
  if (typeof document !== "undefined") {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent ?? "";
  }
  return html.replace(/<[^>]*>/g, "");
}

function RevisionsPanel({
  postId,
  currentTitle,
  currentExcerpt,
  currentBodyHtml,
}: {
  postId: string;
  currentTitle: string;
  currentExcerpt: string;
  currentBodyHtml: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useListCmsPostRevisions(postId);

  const [viewer, setViewer] = useState<{
    revisionId: string;
    editedAt: string;
    author: string;
    mode: "preview" | "diff";
  } | null>(null);

  const detailQ = useQuery({
    queryKey: ["cms-post-revision", postId, viewer?.revisionId ?? null],
    queryFn: () => api.getCmsPostRevision(postId, viewer!.revisionId),
    enabled: !!viewer,
    staleTime: 60_000,
  });

  const restoreMut = useRestoreCmsPostRevision({
    mutation: {
      onSuccess: () => {
        toast({ title: "Revision restored" });
        qc.invalidateQueries({ queryKey: [`/api/cms/posts/${postId}`] });
        qc.invalidateQueries({ queryKey: getListCmsPostRevisionsQueryKey(postId) });
        qc.invalidateQueries({ queryKey: ["/api/cms/posts"] });
      },
      onError: (e: Error) =>
        toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
    },
  });

  const onRestore = (rev: PostRevision) => {
    const when = new Date(rev.editedAt).toLocaleString();
    if (
      !confirm(
        `Restore this post to the version from ${when}?\n\nThe last saved version of the current draft will be kept as a new revision entry so you can undo this. Any unsaved local changes will not be preserved — save first if you want to keep them.`,
      )
    ) {
      return;
    }
    restoreMut.mutate({ id: postId, revisionId: rev.id });
  };

  const openViewer = (rev: PostRevision, mode: "preview" | "diff") => {
    setViewer({
      revisionId: rev.id,
      editedAt: rev.editedAt,
      author: rev.editor?.displayName?.trim() || "Unknown",
      mode,
    });
  };

  if (isLoading) {
    return <div className="mt-3 text-xs text-muted-foreground">Loading revisions…</div>;
  }
  if (isError) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        Could not load revisions.{" "}
        <button className="underline" onClick={() => void refetch()} data-testid="revisions-retry">
          Retry
        </button>
      </div>
    );
  }
  const revisions = data ?? [];
  if (revisions.length === 0) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        No revisions yet. A snapshot is recorded each time the post is saved.
      </div>
    );
  }

  return (
    <>
      <ul className="mt-3 space-y-2" data-testid="revisions-list">
        {revisions.map((rev) => {
          const author = rev.editor?.displayName?.trim() || "Unknown";
          const when = new Date(rev.editedAt).toLocaleString();
          return (
            <li
              key={rev.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-2.5 text-sm"
              data-testid={`revision-${rev.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate" data-testid={`revision-title-${rev.id}`}>
                  {rev.snapshotTitle?.trim() || "Untitled"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {when} · {author}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openViewer(rev, "preview")}
                  data-testid={`button-preview-${rev.id}`}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openViewer(rev, "diff")}
                  data-testid={`button-diff-${rev.id}`}
                >
                  <GitCompare className="h-3.5 w-3.5 mr-1" />
                  Compare
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRestore(rev)}
                  disabled={restoreMut.isPending}
                  data-testid={`button-restore-${rev.id}`}
                >
                  Restore
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <RevisionViewer
        open={!!viewer}
        onClose={() => setViewer(null)}
        mode={viewer?.mode ?? "preview"}
        editedAt={viewer?.editedAt ?? ""}
        author={viewer?.author ?? ""}
        detail={detailQ.data ?? null}
        isLoading={detailQ.isLoading}
        isError={detailQ.isError}
        currentTitle={currentTitle}
        currentExcerpt={currentExcerpt}
        currentBodyHtml={currentBodyHtml}
        onRestore={() => {
          if (viewer) restoreMut.mutate({ id: postId, revisionId: viewer.revisionId });
        }}
        restorePending={restoreMut.isPending}
      />
    </>
  );
}

function RevisionViewer(props: {
  open: boolean;
  onClose: () => void;
  mode: "preview" | "diff";
  editedAt: string;
  author: string;
  detail: PostRevisionDetail | null;
  isLoading: boolean;
  isError: boolean;
  currentTitle: string;
  currentExcerpt: string;
  currentBodyHtml: string;
  onRestore: () => void;
  restorePending: boolean;
}) {
  const {
    open,
    onClose,
    mode,
    editedAt,
    author,
    detail,
    isLoading,
    isError,
    currentTitle,
    currentExcerpt,
    currentBodyHtml,
    onRestore,
    restorePending,
  } = props;

  const [tab, setTab] = useState<"preview" | "diff">(mode);
  useEffect(() => {
    if (open) setTab(mode);
  }, [open, mode]);

  const when = editedAt ? new Date(editedAt).toLocaleString() : "";

  const diffTokens = useMemo(() => {
    if (!detail) return null;
    const oldTitle = detail.snapshotTitle ?? "";
    const newTitle = currentTitle;
    const oldExcerpt = detail.snapshotExcerpt ?? "";
    const newExcerpt = currentExcerpt;
    const oldBody = htmlToText(detail.snapshotBodyHtml ?? "");
    const newBody = htmlToText(currentBodyHtml ?? "");
    return {
      title: diffWords(oldTitle, newTitle),
      excerpt: diffWords(oldExcerpt, newExcerpt),
      body: diffWords(oldBody, newBody),
    };
  }, [detail, currentTitle, currentExcerpt, currentBodyHtml]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Revision from {when}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          Edited by {author}. Read-only — click Restore to bring this version back as
          the current draft.
        </div>

        {isLoading && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Loading snapshot…
          </div>
        )}
        {isError && (
          <div className="py-12 text-center text-sm text-destructive">
            Failed to load revision.
          </div>
        )}

        {detail && (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "preview" | "diff")}
            className="flex flex-col flex-1 min-h-0"
          >
            <TabsList>
              <TabsTrigger value="preview" data-testid="revision-tab-preview">
                <Eye className="h-3.5 w-3.5 mr-1" /> Preview
              </TabsTrigger>
              <TabsTrigger value="diff" data-testid="revision-tab-diff">
                <GitCompare className="h-3.5 w-3.5 mr-1" /> Diff vs current
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="preview"
              className="flex-1 min-h-0 overflow-y-auto border border-border rounded-md p-4 mt-2"
              data-testid="revision-preview-panel"
            >
              <h1 className="text-2xl font-semibold">
                {detail.snapshotTitle?.trim() || "Untitled"}
              </h1>
              {detail.snapshotSubtitle && (
                <p className="mt-1 text-muted-foreground">{detail.snapshotSubtitle}</p>
              )}
              {detail.snapshotExcerpt && (
                <p className="mt-3 text-sm italic text-muted-foreground">
                  {detail.snapshotExcerpt}
                </p>
              )}
              <div
                className="prose prose-sm dark:prose-invert max-w-none mt-4"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(detail.snapshotBodyHtml ?? ""),
                }}
              />
            </TabsContent>

            <TabsContent
              value="diff"
              className="flex-1 min-h-0 overflow-y-auto border border-border rounded-md p-4 mt-2 text-sm"
              data-testid="revision-diff-panel"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Title
              </div>
              <div
                className="mb-4 leading-relaxed"
                data-testid="revision-diff-title"
              >
                {diffTokens?.title.map((t, i) => (
                  <DiffSpan key={`t-${i}`} token={t} />
                ))}
              </div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Excerpt
              </div>
              <div
                className="mb-4 whitespace-pre-wrap leading-relaxed"
                data-testid="revision-diff-excerpt"
              >
                {diffTokens?.excerpt.length === 0 ? (
                  <span className="italic text-muted-foreground">
                    (no excerpt)
                  </span>
                ) : (
                  diffTokens?.excerpt.map((t, i) => (
                    <DiffSpan key={`e-${i}`} token={t} />
                  ))
                )}
              </div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Body
              </div>
              <div
                className="whitespace-pre-wrap leading-relaxed"
                data-testid="revision-diff-body"
              >
                {diffTokens?.body.map((t, i) => (
                  <DiffSpan key={`b-${i}`} token={t} />
                ))}
              </div>
              <div className="mt-4 text-xs text-muted-foreground">
                Green = added in the current draft · red = removed since this revision.
                Diff is computed on readable text (HTML tags stripped).
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-revision-close">
            Close
          </Button>
          <Button
            onClick={() => {
              if (
                confirm(
                  "Restore this revision? The current draft will be snapshotted first so you can undo.",
                )
              ) {
                onRestore();
                onClose();
              }
            }}
            disabled={!detail || restorePending}
            data-testid="button-revision-restore"
          >
            Restore this version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffSpan({ token }: { token: DiffToken }) {
  if (token.op === "eq") return <span>{token.text}</span>;
  if (token.op === "ins")
    return (
      <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 rounded px-0.5">
        {token.text}
      </span>
    );
  return (
    <span className="bg-rose-500/20 text-rose-700 dark:text-rose-200 rounded px-0.5 line-through">
      {token.text}
    </span>
  );
}
