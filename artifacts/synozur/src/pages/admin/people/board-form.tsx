import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  useCreateBoardProfile,
  useListAdminBoard,
  useListBoardTeamOptions,
  useUpdateBoardProfile,
  type BoardProfileInput,
  type MediaItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import { BoardAdminGate } from "@/pages/admin/people/board-list";
import { BOARD_KEY_ROOT, BOARD_REQUEST, useBoardIdentity } from "@/lib/board";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface FormState {
  group: "external" | "internal";
  teamMemberId: number | null;
  slug: string;
  name: string;
  jobTitle: string;
  shortDescription: string;
  longDescription: string;
  imageUrl: string;
  linkedinUrl: string;
  website: string;
  email: string;
  speakerBookingUrl: string;
  active: boolean;
  sortOrder: string;
}

const EMPTY: FormState = {
  group: "external",
  teamMemberId: null,
  slug: "",
  name: "",
  jobTitle: "",
  shortDescription: "",
  longDescription: "",
  imageUrl: "",
  linkedinUrl: "",
  website: "",
  email: "",
  speakerBookingUrl: "",
  active: true,
  sortOrder: "0",
};

const nn = (v: string) => (v.trim() ? v.trim() : null);
const isHttp = (v: string) => !v.trim() || /^https?:\/\//i.test(v.trim());

function BoardFormInner({ id }: { id?: string }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const ident = useBoardIdentity();
  const isNew = !id || id === "new";
  const profileId = isNew ? null : Number(id);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const initFor = useRef<number | null>(null);

  const listQ = useListAdminBoard({
    query: { queryKey: ident.key("admin", "list"), enabled: ident.isAdmin, staleTime: 0, gcTime: 0 },
    request: BOARD_REQUEST,
  });
  const optsQ = useListBoardTeamOptions({
    query: { queryKey: ident.key("admin", "team-options"), enabled: ident.isAdmin, staleTime: 0, gcTime: 0 },
    request: BOARD_REQUEST,
  });

  const existing = profileId != null ? listQ.data?.items.find((p) => p.id === profileId) : undefined;
  const usedTeamIds = new Set(
    (listQ.data?.items ?? [])
      .filter((p) => p.group === "internal" && p.id !== profileId && p.teamMemberId != null)
      .map((p) => p.teamMemberId as number),
  );

  useEffect(() => {
    if (existing && initFor.current !== existing.id) {
      initFor.current = existing.id;
      setForm({
        group: existing.group,
        teamMemberId: existing.teamMemberId ?? null,
        slug: existing.slug ?? "",
        name: existing.name ?? "",
        jobTitle: existing.jobTitle ?? "",
        shortDescription: existing.shortDescription ?? "",
        longDescription: existing.longDescription ?? "",
        imageUrl: existing.imageUrl ?? "",
        linkedinUrl: existing.linkedinUrl ?? "",
        website: existing.website ?? "",
        email: existing.email ?? "",
        speakerBookingUrl: existing.speakerBookingUrl ?? "",
        active: existing.active,
        sortOrder: String(existing.sortOrder ?? 0),
      });
    }
  }, [existing]);

  const done = () => {
    qc.invalidateQueries({ queryKey: [BOARD_KEY_ROOT] });
    navigate("/people/board");
  };
  const onErr = (e: unknown) => setError((e as Error)?.message ?? "Save failed");
  const create = useCreateBoardProfile({ request: BOARD_REQUEST, mutation: { onSuccess: done, onError: onErr } });
  const update = useUpdateBoardProfile({ request: BOARD_REQUEST, mutation: { onSuccess: done, onError: onErr } });
  const pending = create.isPending || update.isPending;

  const submit = () => {
    setError(null);
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    if (!Number.isFinite(sortOrder)) return setError("Order must be a whole number.");
    let payload: BoardProfileInput;
    if (form.group === "internal") {
      if (form.teamMemberId == null) return setError("Choose a Team member to link.");
      payload = { group: "internal", teamMemberId: form.teamMemberId, active: form.active, sortOrder };
    } else {
      if (!form.name.trim()) return setError("Name is required.");
      if (form.slug.trim() && !SLUG_RE.test(form.slug.trim()))
        return setError("Slug may contain lowercase letters, numbers and single hyphens only.");
      for (const [label, v] of [["LinkedIn", form.linkedinUrl], ["Website", form.website], ["Booking", form.speakerBookingUrl]] as const) {
        if (!isHttp(v)) return setError(`${label} URL must start with http:// or https://`);
      }
      payload = {
        group: "external",
        teamMemberId: null,
        name: form.name.trim(),
        ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
        jobTitle: nn(form.jobTitle),
        shortDescription: nn(form.shortDescription),
        longDescription: nn(form.longDescription),
        imageUrl: nn(form.imageUrl),
        linkedinUrl: nn(form.linkedinUrl),
        website: nn(form.website),
        email: nn(form.email),
        speakerBookingUrl: nn(form.speakerBookingUrl),
        active: form.active,
        sortOrder,
      };
    }
    if (isNew) create.mutate({ data: payload });
    else update.mutate({ id: profileId!, data: payload });
  };

  if (!isNew && listQ.isLoading) {
    return (
      <AdminLayout title="Loading…">
        <div className="space-y-3 animate-pulse max-w-3xl">
          <div className="h-9 bg-muted rounded" /><div className="h-40 bg-muted rounded" />
        </div>
      </AdminLayout>
    );
  }
  if (!isNew && (listQ.isError || !existing)) {
    return (
      <AdminLayout title="Advisor not found">
        <p className="text-muted-foreground mb-4">This board profile could not be loaded.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => listQ.refetch()}>Retry</Button>
          <Button variant="ghost" onClick={() => navigate("/people/board")}>Back to board</Button>
        </div>
      </AdminLayout>
    );
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AdminLayout
      title={isNew ? "New Advisor" : `Edit ${existing?.name ?? ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Board of Advisors", href: "/people/board" },
        { label: isNew ? "New" : "Edit" },
      ]}
      actions={
        existing ? (
          <a href={`${BASE_PATH}/board/${encodeURIComponent(existing.slug)}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" data-testid="button-preview-board-profile">
              <ExternalLink className="h-4 w-4 mr-2" /> Preview
            </Button>
          </a>
        ) : undefined
      }
    >
      <button
        onClick={() => navigate("/people/board")}
        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to board
      </button>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-6 max-w-3xl">
        <fieldset className="space-y-2">
          <Label>Advisor type</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ["external", "External advisor", "Has their own name, photo and bio managed here."],
              ["internal", "Existing person", "Shares an existing profile, whether or not it appears on Team."],
            ] as const).map(([val, title, desc]) => (
              <button
                key={val}
                type="button"
                disabled={!isNew}
                onClick={() => set("group", val)}
                className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-60 ${form.group === val ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                data-testid={`button-group-${val}`}
              >
                <p className="font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>
          {!isNew && <p className="text-xs text-muted-foreground">Type cannot change after creation. Create a new entry instead.</p>}
        </fieldset>

        {form.group === "internal" ? (
          <div className="space-y-2">
            <Label htmlFor="teamMemberId">Existing person *</Label>
            <select
              id="teamMemberId"
              value={form.teamMemberId ?? ""}
              onChange={(e) => set("teamMemberId", e.target.value ? Number(e.target.value) : null)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="input-teamMemberId"
            >
              <option value="">{optsQ.isLoading ? "Loading team…" : "Select a team member"}</option>
              {(optsQ.data ?? []).map((o) => (
                <option key={o.id} value={o.id} disabled={usedTeamIds.has(o.id)}>
                  {o.name}{usedTeamIds.has(o.id) ? " (already on board)" : ""}
                </option>
              ))}
            </select>
            {optsQ.isError && (
              <p className="text-xs text-destructive">
                Team list failed to load. <button type="button" className="underline" onClick={() => optsQ.refetch()}>Retry</button>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Name, photo, title, bio and links come from the existing profile under People → Team.
              This does not turn on Show on Team. A person can appear on Board only.
            </p>
            {form.teamMemberId != null && (
              <a className="text-sm text-primary underline" href={`${BASE_PATH}/admin/people/team-members/${form.teamMemberId}`}>
                Edit shared profile and Team / Board visibility
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" required value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="input-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug (auto-generated if empty)</Label>
                <Input id="slug" value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} data-testid="input-slug" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobTitle">Title / affiliation</Label>
              <Input id="jobTitle" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} data-testid="input-jobTitle" />
            </div>
            <div className="space-y-2">
              <Label>Short description</Label>
              <RichTextEditor value={form.shortDescription} onChange={(c) => set("shortDescription", c.html)} />
            </div>
            <div className="space-y-2">
              <Label>Biography</Label>
              <RichTextEditor value={form.longDescription} onChange={(c) => set("longDescription", c.html)} />
            </div>
            <div className="space-y-2">
              <Label>Photo</Label>
              <div className="flex items-start gap-3">
                {form.imageUrl && (
                  <img src={form.imageUrl} alt="" className="w-20 h-20 rounded-md object-cover border border-border flex-shrink-0" />
                )}
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPicker(true)} data-testid="button-pick-photo">
                    {form.imageUrl ? "Change photo" : "Pick from library"}
                  </Button>
                  {form.imageUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set("imageUrl", "")} data-testid="button-clear-photo">
                      Remove photo
                    </Button>
                  )}
                </div>
              </div>
              <MediaPickerModal
                open={picker}
                onClose={() => setPicker(false)}
                onSelect={(m: MediaItem) => { set("imageUrl", mediaUrl(m)); setPicker(false); }}
                title="Pick advisor photo"
                kind="image"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
                <Input id="linkedinUrl" type="url" value={form.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} data-testid="input-linkedinUrl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" type="url" value={form.website} onChange={(e) => set("website", e.target.value)} data-testid="input-website" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="input-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="speakerBookingUrl">Speaker booking page</Label>
                <Input id="speakerBookingUrl" type="url" value={form.speakerBookingUrl} onChange={(e) => set("speakerBookingUrl", e.target.value)} data-testid="input-speakerBookingUrl" />
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
          <div className="space-y-2">
            <Label htmlFor="sortOrder">Order within group</Label>
            <Input id="sortOrder" type="number" step={1} value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} data-testid="input-sortOrder" />
            <p className="text-xs text-muted-foreground">Lower numbers first. External advisors always list before shared profiles.</p>
          </div>
          <div className="flex items-center gap-2 pb-6">
            <input id="active" type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} data-testid="input-active" />
            <Label htmlFor="active">Show on Board</Label>
          </div>
        </div>

        {error && <div className="text-destructive text-sm" data-testid="text-form-error">{error}</div>}

        <div className="flex items-center gap-3 pt-4">
          <Button type="submit" disabled={pending} data-testid="button-save">
            {pending ? "Saving…" : isNew ? "Create Advisor" : "Save Changes"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/people/board")}>Cancel</Button>
        </div>
      </form>
    </AdminLayout>
  );
}

export default function BoardForm({ id }: { id?: string }) {
  return (
    <BoardAdminGate>
      <BoardFormInner id={id} />
    </BoardAdminGate>
  );
}
