import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { MediaPickerModal, mediaUrl, uploadAndRegisterImage } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
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
  ogImageId: string | null;
  ogImageUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
  categoryIds: string[];
  tagIds: string[];
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
  ogImageId: null,
  ogImageUrl: null,
  seoTitle: "",
  seoDescription: "",
  seoCanonicalUrl: "",
  categoryIds: [],
  tagIds: [],
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
    ogImageId: null,
    ogImageUrl: p.ogImageUrl ?? null,
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    seoCanonicalUrl: p.seoCanonicalUrl ?? "",
    categoryIds: (p.categories ?? []).map((c) => c.id),
    tagIds: (p.tags ?? []).map((t) => t.id),
  };
}

function toBody(state: FormState): CreatePostBody {
  return {
    title: state.title,
    slug: state.slug || null,
    subtitle: state.subtitle || null,
    excerpt: state.excerpt || null,
    bodyHtml: state.bodyHtml || null,
    bodyMarkdown: state.bodyMarkdown || null,
    heroImageId: state.heroImageId,
    ogImageId: state.ogImageId,
    seoTitle: state.seoTitle || null,
    seoDescription: state.seoDescription || null,
    seoCanonicalUrl: state.seoCanonicalUrl || null,
    categoryIds: state.categoryIds,
    tagIds: state.tagIds,
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

  useEffect(() => {
    if (existing) {
      setForm(fromPost(existing));
      setSavedAt(new Date(existing.updatedAt));
      setDirty(false);
      setSlugTouched(true);
      setScheduleDate(existing.scheduledFor ? toLocalDateTime(existing.scheduledFor) : "");
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
        navigate("/admin/posts");
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
    if (!confirm("Archive this post?")) return;
    await archiveMut.mutateAsync({ id: postId });
  };

  const handleHero = (m: MediaItem) => {
    update({ heroImageId: m.id, heroImageUrl: mediaUrl(m) });
  };
  const handleOg = (m: MediaItem) => {
    update({ ogImageId: m.id, ogImageUrl: mediaUrl(m) });
  };

  const addTagFromInput = async () => {
    const name = tagInput.trim();
    if (!name) return;
    const all = tags.data ?? [];
    const existingT = all.find((t) => t.name.toLowerCase() === name.toLowerCase());
    let tag: Tag | null = existingT ?? null;
    if (!tag) {
      const created = await createTagMut.mutateAsync({
        data: { slug: slugify(name), name },
      });
      tag = created;
    }
    if (tag && !form.tagIds.includes(tag.id)) {
      update({ tagIds: [...form.tagIds, tag.id] });
    }
    setTagInput("");
  };

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    (tags.data ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [tags.data]);

  const previewUrl = postId ? `${BASE_PATH}/admin/posts/${postId}/preview` : null;

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
        { label: "Admin", href: "/admin" },
        { label: "Posts", href: "/admin/posts" },
        { label: isNew ? "New" : existing?.title ?? "Edit" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/admin/posts")}>
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

          <Card className="p-0 overflow-hidden">
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
                <div>
                  <Label>OG Image</Label>
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
                      <Button type="button" variant="ghost" size="sm" onClick={() => update({ ogImageId: null, ogImageUrl: null })}>
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
              {showHistory && <RevisionsPanel postId={postId!} />}
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
                <Button variant="ghost" size="sm" onClick={() => update({ heroImageId: null, heroImageUrl: null })}>
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </Card>

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
                placeholder="Add tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
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

function RevisionsPanel({ postId }: { postId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useListCmsPostRevisions(postId);
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(rev)}
              disabled={restoreMut.isPending}
              data-testid={`button-restore-${rev.id}`}
            >
              Restore
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
