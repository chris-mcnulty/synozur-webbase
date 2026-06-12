// EditWedge body — the floating chip + edit modal. Heavy by design
// (Dialog, Select, Textarea, MediaPickerModal, Uppy via the picker,
// React Query mutation), so it's split out and lazy-loaded by the
// thin gate in `edit-wedge.tsx`. Anonymous traffic never downloads
// this chunk.
//
// Default-exported so `React.lazy(() => import("./edit-wedge-body"))`
// works without a named-export shim.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Save, X, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import {
  type EntityKind,
  adminEditPathFor,
  getEntityRegistration,
} from "@/lib/entity-registry";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "@/lib/insights";
import type { EntitySnapshot } from "./edit-wedge";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/**
 * PATCH URL builder, by kind. Mirrors the routes already in use by
 * `lib/api.ts`.
 */
function patchUrlFor(kind: EntityKind, id: string | number): string {
  switch (kind) {
    case "post":
      return `${BASE_PATH}/api/cms/posts/${id}`;
    case "service":
      return `${BASE_PATH}/api/cms/services/${id}`;
    case "solution":
      return `${BASE_PATH}/api/cms/solutions/${id}`;
    case "case-study":
      return `${BASE_PATH}/api/cms/case-studies/${id}`;
    case "application":
      return `${BASE_PATH}/api/cms/applications/${id}`;
    case "model":
      return `${BASE_PATH}/api/cms/models/${id}`;
    case "white-paper":
      return `${BASE_PATH}/api/cms/white-papers/${id}`;
    case "video":
      return `${BASE_PATH}/api/cms/videos/${id}`;
    case "workshop":
      // Workshops live in their own table, not collateral. Routes that mount
      // the wedge with `kind=workshop` pass a workshop id, not the synced
      // collateral row id, so the PATCH must hit /cms/workshops/:id.
      return `${BASE_PATH}/api/cms/workshops/${id}`;
    case "webinar":
    case "library-item":
      return `${BASE_PATH}/api/cms/collateral/${id}`;
    case "polaris-episode":
      return `${BASE_PATH}/api/cms/polaris/episodes/${id}`;
    case "team-member":
      return `${BASE_PATH}/api/admin/team-members/${id}`;
    case "event":
      return `${BASE_PATH}/api/admin/events/${id}`;
    case "job":
      return `${BASE_PATH}/api/cms/careers/jobs/${id}`;
    case "landing-page":
      return `${BASE_PATH}/api/cms/landing-pages/${id}`;
  }
}

/** Full admin edit URL with the SPA's BASE_URL prefix. */
function adminEditHref(kind: EntityKind, id: string | number): string {
  return `${BASE_PATH}${adminEditPathFor(kind, id)}`;
}

interface BodyProps {
  kind: EntityKind;
  id: string | number;
  slug: string;
  snapshot: EntitySnapshot;
  queryKey?: readonly unknown[];
  onSaved?: () => void;
}

export default function EditWedgeBody({ kind, id, slug, snapshot, queryKey, onSaved }: BodyProps) {
  const reg = getEntityRegistration(kind);
  const [open, setOpen] = useState(false);
  return (
    <>
      <FloatingChip onClick={() => setOpen(true)} label={`Edit ${reg.label.toLowerCase()}`} />
      {open && (
        <EditModal
          kind={kind}
          id={id}
          slug={slug}
          snapshot={snapshot}
          queryKey={queryKey}
          onSaved={onSaved}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Floating chip
// ---------------------------------------------------------------------------

function FloatingChip({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid="edit-wedge-chip"
      className={cn(
        "fixed bottom-6 right-6 z-40",
        "flex items-center gap-2 px-3 py-2 rounded-full",
        "bg-primary text-primary-foreground shadow-lg",
        "text-sm font-medium",
        "opacity-70 hover:opacity-100 focus-visible:opacity-100",
        "transition-opacity",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <Pencil className="h-4 w-4" aria-hidden="true" />
      <span>Edit</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface FormState {
  title: string;
  /** Subtitle-equivalent value. The server key is per-kind (`subtitle`,
   *  `summary`, `shortDescription`, `tagline`) — see `reg.subtitleKey`. */
  subtitle: string;
  seoTitle: string;
  seoDescription: string;
  status: string;
  heroImageId: string | null;
  ogImageId: string | null;
  // Display-only URLs so the modal can show the current images as
  // thumbnails. The public payload often carries the URL but not the id.
  heroImageUrl: string | null;
  ogImageUrl: string | null;
}

function readSubtitle(s: EntitySnapshot, key: string | null): string {
  if (!key) return "";
  const v = (s as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

function snapshotToForm(s: EntitySnapshot, subtitleKey: string | null): FormState {
  return {
    title: s.title ?? "",
    subtitle: readSubtitle(s, subtitleKey),
    seoTitle: s.seoTitle ?? "",
    seoDescription: s.seoDescription ?? "",
    status: s.status ?? (s.active === false ? "inactive" : ""),
    heroImageId: s.heroImageId ?? null,
    ogImageId: s.ogImageId ?? null,
    heroImageUrl: s.heroImageUrl ?? s.heroImage ?? null,
    ogImageUrl: s.ogImageUrl ?? s.ogImage ?? null,
  };
}

function diffPatch(
  initial: FormState,
  current: FormState,
  reg: ReturnType<typeof getEntityRegistration>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (current.title !== initial.title) patch.title = current.title;
  if (reg.subtitleKey && current.subtitle !== initial.subtitle) {
    // Per-kind server key — different entities call this column
    // different things (subtitle / summary / shortDescription / tagline).
    patch[reg.subtitleKey] = current.subtitle;
  }
  if (reg.seoPatch) {
    if (current.seoTitle !== initial.seoTitle) patch.seoTitle = current.seoTitle;
    if (current.seoDescription !== initial.seoDescription)
      patch.seoDescription = current.seoDescription;
  }
  if (current.status !== initial.status && current.status !== "") patch.status = current.status;
  if (reg.imageIdPatch) {
    if (current.heroImageId !== initial.heroImageId) patch.heroImageId = current.heroImageId;
    if (current.ogImageId !== initial.ogImageId) patch.ogImageId = current.ogImageId;
  }
  return patch;
}

function EditModal({
  kind,
  id,
  slug,
  snapshot,
  queryKey,
  onSaved,
  onClose,
}: {
  kind: EntityKind;
  id: string | number;
  slug: string;
  snapshot: EntitySnapshot;
  queryKey?: readonly unknown[];
  onSaved?: () => void;
  onClose: () => void;
}) {
  const reg = getEntityRegistration(kind);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initial = useRef(snapshotToForm(snapshot, reg.subtitleKey)).current;
  const [form, setForm] = useState<FormState>(initial);
  const [pickingHero, setPickingHero] = useState(false);
  const [pickingOg, setPickingOg] = useState(false);
  const statusChoices = reg.statusEnum;

  const patch = diffPatch(initial, form, reg);
  const hasChanges = Object.keys(patch).length > 0;

  const heroPreview = resolveMediaUrl(form.heroImageUrl, { width: 200 }) ?? undefined;
  const ogPreview = resolveMediaUrl(form.ogImageUrl, { width: 200 }) ?? undefined;

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(patchUrlFor(kind, id), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Save failed (${res.status})`);
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: async () => {
      toast({ title: "Saved", description: `${reg.label} updated.` });
      // Invalidate the page's own query when we know it; otherwise broad.
      if (queryKey) {
        await queryClient.invalidateQueries({ queryKey });
      } else {
        await queryClient.invalidateQueries();
      }
      // For pages that don't use React Query (e.g. library-detail and
      // webinar-detail load via useEffect + fetchCollateralBySlug),
      // invalidateQueries is a no-op — they need an explicit refetch
      // hook to refresh the displayed content after a save.
      onSaved?.();
      onClose();
    },
    onError: (err) => {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  // Esc closes (Dialog handles this but we also catch it for the picker overlays).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !save.isPending && !pickingHero && !pickingOg) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, save.isPending, pickingHero, pickingOg]);

  // Kinds whose update routes don't accept a partial diff (team_members,
  // events) — surface the wedge as a navigation shortcut to the full
  // editor rather than a form that would 400 on save.
  if (!reg.inlinePatch) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {reg.label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Inline edits aren&apos;t supported for {reg.label.toLowerCase()}s
              yet. Open the full editor to make changes — it&apos;ll launch in
              a new tab so you can keep this page open for reference.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              <X className="h-4 w-4 mr-2" aria-hidden="true" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                window.open(adminEditHref(kind, id), "_blank", "noopener");
                onClose();
              }}
              data-testid="edit-wedge-open-editor"
            >
              <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
              Open full editor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {reg.label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Quick edits to the {reg.label.toLowerCase()} attributes for{" "}
            <span className="font-mono text-xs">{slug}</span>. For deeper
            changes (body, related items, methodologies, etc.), use the full
            editor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-wedge-title">Title</Label>
            <Input
              id="edit-wedge-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              data-testid="edit-wedge-title"
            />
          </div>

          {reg.subtitleKey && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-wedge-subtitle">{reg.subtitleLabel ?? "Subtitle"}</Label>
              <Textarea
                id="edit-wedge-subtitle"
                value={form.subtitle}
                onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                rows={2}
                data-testid="edit-wedge-subtitle"
              />
            </div>
          )}

          {statusChoices && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-wedge-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger id="edit-wedge-status" data-testid="edit-wedge-status">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {statusChoices.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {reg.imageIdPatch && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hero image</Label>
                {heroPreview ? (
                  <img
                    src={heroPreview}
                    alt=""
                    className="h-20 w-full rounded-md border border-border object-cover bg-muted"
                  />
                ) : (
                  <div className="flex h-20 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                    No image
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickingHero(true)}
                  className="w-full justify-start"
                >
                  {form.heroImageId || form.heroImageUrl ? "Change…" : "Pick image…"}
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>OG image</Label>
                {ogPreview ? (
                  <img
                    src={ogPreview}
                    alt=""
                    className="h-20 w-full rounded-md border border-border object-cover bg-muted"
                  />
                ) : (
                  <div className="flex h-20 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                    No image
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickingOg(true)}
                  className="w-full justify-start"
                >
                  {form.ogImageId || form.ogImageUrl ? "Change…" : "Pick image…"}
                </Button>
              </div>
            </div>
          )}

          {reg.seoPatch && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-wedge-seo-title">SEO title</Label>
                <Input
                  id="edit-wedge-seo-title"
                  value={form.seoTitle}
                  onChange={(e) => setForm((f) => ({ ...f, seoTitle: e.target.value }))}
                  maxLength={70}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-wedge-seo-description">SEO description</Label>
                <Textarea
                  id="edit-wedge-seo-description"
                  value={form.seoDescription}
                  onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))}
                  rows={2}
                  maxLength={160}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.open(adminEditHref(kind, id), "_blank", "noopener")}
          >
            <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
            Open full editor
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={save.isPending}>
            <X className="h-4 w-4 mr-2" aria-hidden="true" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => save.mutate()}
            disabled={!hasChanges || save.isPending}
            data-testid="edit-wedge-save"
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4 mr-2" aria-hidden="true" />
            )}
            Save
          </Button>
        </DialogFooter>

        <MediaPickerModal
          open={pickingHero}
          onClose={() => setPickingHero(false)}
          onSelect={(m) => {
            setForm((f) => ({ ...f, heroImageId: m.id, heroImageUrl: m.publicUrl }));
            setPickingHero(false);
          }}
          selectedId={form.heroImageId ?? undefined}
          title="Pick hero image"
        />
        <MediaPickerModal
          open={pickingOg}
          onClose={() => setPickingOg(false)}
          onSelect={(m) => {
            setForm((f) => ({ ...f, ogImageId: m.id, ogImageUrl: m.publicUrl }));
            setPickingOg(false);
          }}
          selectedId={form.ogImageId ?? undefined}
          title="Pick OG image"
        />
      </DialogContent>
    </Dialog>
  );
}
