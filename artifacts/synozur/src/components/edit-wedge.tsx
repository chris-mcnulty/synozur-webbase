// EditWedge — the "edit this page without leaving the live site" affordance.
//
// Usage: each public detail page mounts <EditWedge ... /> with the entity it
// renders. For signed-in users with the right capability, a small floating
// chip appears bottom-right; clicking it opens a metadata-edit modal that
// patches the entity in place. For everyone else, the wedge renders nothing
// — anonymous visitors never see it.
//
// Scope of the modal is intentionally narrow ("page attributes" — title,
// subtitle/description, hero image, SEO title / description, OG image,
// status), not the long-form body. The modal includes an "Open full editor"
// link to the matching admin edit page for deeper edits.
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
import { useAdminAccess } from "@/components/admin/AdminGate";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import { useToast } from "@/hooks/use-toast";
import {
  type EntityKind,
  adminEditPathFor,
  getEntityRegistration,
} from "@/lib/entity-registry";
import { cn } from "@/lib/utils";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** PATCH URL builder, by kind. Mirrors the routes already in use by `lib/api.ts`. */
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
  }
}

/**
 * Snapshot of the entity as the public page already loaded it. The wedge
 * reads a few well-known fields if present and quietly ignores the rest;
 * fields the public payload doesn't expose just render as empty.
 *
 * Permissive `[key: string]: unknown` so detail pages can spread their
 * full DTOs in without TS arguing about extra properties.
 */
export type EntitySnapshot = {
  id?: string | number | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  // Status surfaces vary across entities — accept any of these.
  status?: string | null;
  active?: boolean | null;
  publishedAt?: string | null;
  // Image fields. Public payload may carry id, URL, or both.
  heroImageId?: string | null;
  heroImage?: string | null;
  ogImageId?: string | null;
  ogImage?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
} & { [key: string]: unknown };

interface EditWedgeProps {
  kind: EntityKind;
  id: string | number | null | undefined;
  slug: string | null | undefined;
  /**
   * Current entity payload from the page's own React Query call.
   * Permissive `unknown` so detail pages can pass their typed DTOs
   * without juggling type casts; the wedge reads the well-known
   * fields it cares about and ignores the rest.
   */
  snapshot: unknown;
  /**
   * Optional. The React Query key the public page uses to fetch this entity.
   * When provided, the wedge invalidates it after a successful save so the
   * page re-renders with new content. When absent, the wedge invalidates
   * everything (broad but safe).
   */
  queryKey?: readonly unknown[];
}

function asSnapshot(v: unknown): EntitySnapshot {
  if (v && typeof v === "object") return v as EntitySnapshot;
  return {};
}

export function EditWedge({ kind, id, slug, snapshot, queryKey }: EditWedgeProps) {
  const { access, signedIn } = useAdminAccess();
  const reg = getEntityRegistration(kind);
  const [open, setOpen] = useState(false);

  const canEdit =
    signedIn &&
    access &&
    reg.capabilities.some((cap) => access.hasCapability(cap));

  if (!canEdit) return null;
  if (!id || !slug) return null;

  return (
    <>
      <FloatingChip onClick={() => setOpen(true)} label={`Edit ${reg.label.toLowerCase()}`} />
      {open && (
        <EditModal
          kind={kind}
          id={id}
          slug={slug}
          snapshot={asSnapshot(snapshot)}
          queryKey={queryKey}
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
  subtitle: string;
  seoTitle: string;
  seoDescription: string;
  status: string;
  heroImageId: string | null;
  ogImageId: string | null;
}

function snapshotToForm(s: EntitySnapshot): FormState {
  return {
    title: s.title ?? "",
    subtitle: s.subtitle ?? s.description ?? "",
    seoTitle: s.seoTitle ?? "",
    seoDescription: s.seoDescription ?? "",
    status: s.status ?? (s.active === false ? "inactive" : ""),
    heroImageId: s.heroImageId ?? null,
    ogImageId: s.ogImageId ?? null,
  };
}

function diffPatch(initial: FormState, current: FormState): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (current.title !== initial.title) patch.title = current.title;
  if (current.subtitle !== initial.subtitle) patch.subtitle = current.subtitle;
  if (current.seoTitle !== initial.seoTitle) patch.seoTitle = current.seoTitle;
  if (current.seoDescription !== initial.seoDescription)
    patch.seoDescription = current.seoDescription;
  if (current.status !== initial.status && current.status !== "") patch.status = current.status;
  if (current.heroImageId !== initial.heroImageId) patch.heroImageId = current.heroImageId;
  if (current.ogImageId !== initial.ogImageId) patch.ogImageId = current.ogImageId;
  return patch;
}

const STATUS_CHOICES_ARTIFACT = ["draft", "scheduled", "published", "archived"] as const;
const STATUS_CHOICES_EVENT = ["UPCOMING", "ENDED", "CANCELLED"] as const;
const STATUS_CHOICES_JOB = ["draft", "published", "closed"] as const;

function statusChoicesFor(kind: EntityKind): readonly string[] | null {
  switch (kind) {
    case "post":
    case "service":
    case "solution":
    case "case-study":
    case "application":
    case "model":
    case "polaris-episode":
      return STATUS_CHOICES_ARTIFACT;
    case "event":
      return STATUS_CHOICES_EVENT;
    case "job":
      return STATUS_CHOICES_JOB;
    default:
      // Collateral kinds, team members — no status enum, controlled by
      // `publishedAt` / `active`. Hide the field rather than guessing.
      return null;
  }
}

function EditModal({
  kind,
  id,
  slug,
  snapshot,
  queryKey,
  onClose,
}: {
  kind: EntityKind;
  id: string | number;
  slug: string;
  snapshot: EntitySnapshot;
  queryKey?: readonly unknown[];
  onClose: () => void;
}) {
  const reg = getEntityRegistration(kind);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initial = useRef(snapshotToForm(snapshot)).current;
  const [form, setForm] = useState<FormState>(initial);
  const [pickingHero, setPickingHero] = useState(false);
  const [pickingOg, setPickingOg] = useState(false);
  const statusChoices = statusChoicesFor(kind);

  const patch = diffPatch(initial, form);
  const hasChanges = Object.keys(patch).length > 0;

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

          <div className="space-y-1.5">
            <Label htmlFor="edit-wedge-subtitle">Subtitle / description</Label>
            <Textarea
              id="edit-wedge-subtitle"
              value={form.subtitle}
              onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
              rows={2}
              data-testid="edit-wedge-subtitle"
            />
          </div>

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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Hero image</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickingHero(true)}
                className="w-full justify-start"
              >
                {form.heroImageId ? "Change…" : "Pick image…"}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>OG image</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickingOg(true)}
                className="w-full justify-start"
              >
                {form.ogImageId ? "Change…" : "Pick image…"}
              </Button>
            </div>
          </div>

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
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.open(adminEditPathFor(kind, id), "_blank", "noopener")}
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
            setForm((f) => ({ ...f, heroImageId: m.id }));
            setPickingHero(false);
          }}
          selectedId={form.heroImageId ?? undefined}
          title="Pick hero image"
        />
        <MediaPickerModal
          open={pickingOg}
          onClose={() => setPickingOg(false)}
          onSelect={(m) => {
            setForm((f) => ({ ...f, ogImageId: m.id }));
            setPickingOg(false);
          }}
          selectedId={form.ogImageId ?? undefined}
          title="Pick OG image"
        />
      </DialogContent>
    </Dialog>
  );
}
