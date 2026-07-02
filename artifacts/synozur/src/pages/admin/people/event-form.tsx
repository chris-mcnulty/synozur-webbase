import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Image as ImageIcon,
  X,
  RefreshCw,
  MapPin,
  Film,
  ChevronUp,
  ChevronDown,
  Users,
  Link2,
  CheckCircle2,
  CalendarDays,
  Plus,
  Trash2,
  Upload,
  ExternalLink,
  Search,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type EventSessionInput } from "@/lib/api";
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { MediaItem } from "@workspace/api-client-react";
import type { EventInput } from "@workspace/api-zod/types";

const COMMON_TIMEZONES: { label: string; value: string }[] = [
  { label: "UTC", value: "UTC" },
  { label: "Eastern Time — New York, Miami", value: "America/New_York" },
  { label: "Central Time — Chicago, Dallas", value: "America/Chicago" },
  { label: "Mountain Time — Denver", value: "America/Denver" },
  { label: "Pacific Time — Los Angeles, Seattle", value: "America/Los_Angeles" },
  { label: "Alaska (AKT)", value: "America/Anchorage" },
  { label: "Hawaii (HST)", value: "Pacific/Honolulu" },
  { label: "Atlantic — Halifax (AT)", value: "America/Halifax" },
  { label: "São Paulo (BRT)", value: "America/Sao_Paulo" },
  { label: "London (GMT/BST)", value: "Europe/London" },
  { label: "Paris / Berlin (CET)", value: "Europe/Paris" },
  { label: "Helsinki / Kyiv (EET)", value: "Europe/Helsinki" },
  { label: "Dubai (GST)", value: "Asia/Dubai" },
  { label: "Mumbai / New Delhi (IST)", value: "Asia/Kolkata" },
  { label: "Bangkok / Jakarta (ICT)", value: "Asia/Bangkok" },
  { label: "Singapore / KL (SGT)", value: "Asia/Singapore" },
  { label: "Tokyo / Osaka (JST)", value: "Asia/Tokyo" },
  { label: "Sydney / Melbourne (AEST)", value: "Australia/Sydney" },
  { label: "Auckland / Wellington (NZST)", value: "Pacific/Auckland" },
];

type SessionDraft = EventSessionInput & { _id: string };

function blankSession(idx: number): SessionDraft {
  return {
    _id: crypto.randomUUID(),
    title: "",
    sessionType: null,
    speakers: null,
    track: null,
    room: null,
    startTime: null,
    sessionUrl: null,
    sortOrder: idx,
  };
}

function parseCsv(text: string): SessionDraft[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line, idx) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const get = (key: string) => {
      const i = headers.indexOf(key);
      return i >= 0 && cols[i] ? cols[i] : null;
    };
    return {
      _id: crypto.randomUUID(),
      title: get("title") ?? `Session ${idx + 1}`,
      sessionType: get("sessiontype") ?? get("type"),
      speakers: get("speakers"),
      track: get("track"),
      room: get("room"),
      startTime: get("starttime") ?? get("start_time") ?? get("start"),
      sessionUrl: get("sessionurl") ?? get("url"),
      sortOrder: idx,
    };
  });
}

interface Props {
  id?: string;
}

function toLocalInput(iso: string | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventForm({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isNew = !id;
  const eventId = id ? Number(id) : null;

  const [form, setForm] = useState<EventInput>({
    title: "",
    slug: "",
    startDate: new Date(),
    endDate: null,
    location: null,
    teaser: null,
    description: null,
    registrationUrl: null,
    registrationStatus: "UNKNOWN_REGISTRATION_STATUS",
    eventType: "RSVP",
    status: "UPCOMING",
    featured: false,
    featuredRank: null,
    imageAssetId: null,
    imageMediaId: null,
    recordingVideoId: null,
    speakerIds: [],
    timezone: null,
    seoTitle: null,
    seoDescription: null,
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [libraryMode, setLibraryMode] = useState<"any" | "location" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionDraft[]>([]);
  const [sessionSaveStatus, setSessionSaveStatus] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const formInitializedRef = useRef(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["admin-event", eventId],
    queryFn: () => api.getEvent(eventId!),
    enabled: eventId != null,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (existing && !formInitializedRef.current) {
      formInitializedRef.current = true;
      setForm({
        title: existing.title,
        slug: existing.slug,
        startDate: existing.startDate,
        endDate: existing.endDate ?? null,
        location: existing.location,
        teaser: existing.teaser,
        description: existing.description,
        registrationUrl: existing.registrationUrl,
        registrationStatus: existing.registrationStatus,
        eventType: existing.eventType,
        status: existing.status,
        featured: existing.featured ?? false,
        featuredRank: existing.featuredRank ?? null,
        imageAssetId: existing.imageAssetId,
        imageMediaId: existing.imageMediaId ?? null,
        recordingVideoId: existing.recordingVideoId ?? null,
        speakerIds:
          (existing.speakers ?? [])
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => s.teamMemberId) ?? [],
        timezone: existing.timezone ?? null,
        seoTitle: existing.seoTitle ?? null,
        seoDescription: existing.seoDescription ?? null,
      });
      setImagePreview(existing.imageUrl ?? null);
    }
  }, [existing]);

  const scheduleQ = useQuery({
    queryKey: ["event-schedule-admin", existing?.slug],
    queryFn: () => api.getEventSchedule(existing!.slug),
    enabled: Boolean(existing?.slug),
  });

  useEffect(() => {
    if (scheduleQ.data?.items) {
      setSessions(
        scheduleQ.data.items.map((s) => ({
          _id: s.id.toString(),
          title: s.title,
          sessionType: s.sessionType ?? null,
          speakers: s.speakers ?? null,
          track: s.track ?? null,
          room: s.room ?? null,
          startTime:
            s.startTime != null
              ? new Date(s.startTime as unknown as string | Date).toISOString()
              : null,
          sessionUrl: s.sessionUrl ?? null,
          sortOrder: s.sortOrder,
        }))
      );
    }
  }, [scheduleQ.data]);

  const sessionsMutation = useMutation({
    mutationFn: () =>
      api.replaceEventSessions(
        eventId!,
        sessions.map((s, idx) => ({
          title: s.title,
          sessionType: s.sessionType,
          speakers: s.speakers,
          track: s.track,
          room: s.room,
          startTime: s.startTime,
          sessionUrl: s.sessionUrl,
          sortOrder: idx,
        }))
      ),
    onSuccess: () => {
      setSessionSaveStatus(`Schedule saved — ${sessions.length} session${sessions.length !== 1 ? "s" : ""}.`);
      scheduleQ.refetch();
    },
    onError: (e: Error) => setSessionSaveStatus(`Error: ${e.message}`),
  });

  const handleCsvFile = useCallback((file: File) => {
    file.text().then((text) => {
      const parsed = parseCsv(text);
      if (parsed.length > 0) {
        setSessions((prev) => [...prev, ...parsed]);
        setSessionSaveStatus(`Imported ${parsed.length} session${parsed.length !== 1 ? "s" : ""} from CSV — click Save Schedule to persist.`);
      } else {
        setSessionSaveStatus("No sessions found in CSV. Expected a header row with at least a 'title' column.");
      }
    });
  }, []);

  const teamMembersQ = useQuery({
    queryKey: ["admin-team-members-for-event"],
    queryFn: () => api.adminTeamMembers(),
  });

  const speakerIds = form.speakerIds ?? [];

  const speakerLookup = useMemo(() => {
    const map = new Map<number, { name: string; jobTitle: string; active: boolean }>();
    for (const m of teamMembersQ.data ?? []) {
      map.set(m.id, {
        name: m.name,
        jobTitle: m.jobTitle,
        active: m.active,
      });
    }
    return map;
  }, [teamMembersQ.data]);

  const availableTeamMembers = useMemo(() => {
    const selected = new Set(speakerIds);
    return (teamMembersQ.data ?? [])
      .filter((m) => m.active && !selected.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teamMembersQ.data, speakerIds]);

  const addSpeaker = (id: number) => {
    setForm((f) => ({ ...f, speakerIds: [...(f.speakerIds ?? []), id] }));
  };
  const removeSpeaker = (id: number) => {
    setForm((f) => ({
      ...f,
      speakerIds: (f.speakerIds ?? []).filter((x) => x !== id),
    }));
  };
  const moveSpeaker = (id: number, delta: -1 | 1) => {
    setForm((f) => {
      const ids = (f.speakerIds ?? []).slice();
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return f;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...f, speakerIds: ids };
    });
  };

  const videosQ = useQuery({
    queryKey: ["admin-videos-for-event"],
    queryFn: () => api.adminListVideos(),
  });
  const videoOptions = useMemo(() => {
    const now = Date.now();
    const items = (videosQ.data?.items ?? []).filter((v) => {
      if (v.status !== "published" || !v.active) return false;
      if (!v.publishedAt || new Date(v.publishedAt).getTime() > now) return false;
      if (v.unpublishedAt && new Date(v.unpublishedAt).getTime() <= now) return false;
      return true;
    });
    return [...items].sort((a, b) => {
      const ad = a.publishedAt || a.recordedAt || a.createdAt;
      const bd = b.publishedAt || b.recordedAt || b.createdAt;
      return new Date(bd).getTime() - new Date(ad).getTime();
    });
  }, [videosQ.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return api.createEvent(form);
      return api.updateEvent(eventId!, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-events"] });
      qc.invalidateQueries({ queryKey: ["admin-event", eventId] });
      qc.invalidateQueries({ queryKey: ["public-events"] });
      navigate("/people/events");
    },
    onError: (e: Error) => setError(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncEventToCollateral(eventId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cms/collateral"] });
      qc.invalidateQueries({ queryKey: ["collateral"] });
      setSyncStatus("Synced to collateral.");
    },
    onError: (e: Error) => setSyncStatus(`Sync failed: ${e.message}`),
  });

  const title = isNew ? "Create Event" : "Edit Event";
  const crumbs = [
    { label: "Admin", href: "/" },
    { label: "Events", href: "/people/events" },
    { label: title },
  ];

  if (!isNew && isLoading) {
    return (
      <AdminLayout title={title} crumbs={crumbs}>
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

  // New writes flow through `imageMediaId` (UUID, FK to `media`); the legacy
  // integer `imageAssetId` is cleared so the server's URL resolver consults
  // the unified media table on read instead of the legacy assets table.
  const handleSelectMedia = (m: MediaItem) => {
    setForm((f) => ({ ...f, imageAssetId: null, imageMediaId: m.id }));
    setImagePreview(mediaUrl(m));
  };

  return (
    <AdminLayout
      title={title}
      crumbs={crumbs}
      previewEntity={{
        kind: "event",
        id,
        slug: form.slug ?? null,
        // The public events route serves rows of any status (UPCOMING /
        // ENDED / CANCELLED) — none of those are "drafts" from the
        // public visibility standpoint. Treat events as not-draft until
        // a real draft flag exists.
        isDraft: false,
      }}
    >
      <div className="max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          saveMutation.mutate();
        }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            data-testid="input-title"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">Slug (auto-generated if empty)</Label>
          <Input
            id="slug"
            value={form.slug ?? ""}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            data-testid="input-slug"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startDate">Start Date & Time *</Label>
          <Input
            id="startDate"
            type="datetime-local"
            required
            value={toLocalInput(form.startDate)}
            onChange={(e) =>
              setForm({ ...form, startDate: new Date(e.target.value) })
            }
            data-testid="input-startDate"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="endDate">End Date & Time</Label>
          <Input
            id="endDate"
            type="datetime-local"
            value={form.endDate ? toLocalInput(form.endDate) : ""}
            onChange={(e) =>
              setForm({
                ...form,
                endDate: e.target.value ? new Date(e.target.value) : null,
              })
            }
            data-testid="input-endDate"
          />
          <p className="text-xs text-muted-foreground">
            Optional. Used for ICS calendar files and auto-expiry. Defaults to
            start date + 24 h for ICS when left blank.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={form.location ?? ""}
            onChange={(e) => setForm({ ...form, location: e.target.value || null })}
            data-testid="input-location"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="timezone">Event Timezone</Label>
          <select
            id="timezone"
            data-testid="select-timezone"
            value={form.timezone ?? ""}
            onChange={(e) =>
              setForm({ ...form, timezone: e.target.value || null })
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">— not set (UTC) —</option>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Used for correct time display on the schedule page and ICS calendar downloads.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="teaser">Teaser</Label>
          <Textarea
            id="teaser"
            rows={2}
            placeholder="One or two sentences shown under the event title."
            value={form.teaser ?? ""}
            onChange={(e) =>
              setForm({ ...form, teaser: e.target.value || null })
            }
            data-testid="input-teaser"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={6}
            value={form.description ?? ""}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value || null })
            }
            data-testid="input-description"
          />
        </div>

        <div className="space-y-2">
          <Label>Event Status</Label>
          <Select
            value={form.status || "UPCOMING"}
            onValueChange={(v) => setForm({ ...form, status: v })}
          >
            <SelectTrigger data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UPCOMING">Upcoming</SelectItem>
              <SelectItem value="ENDED">Ended</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Registration card */}
        <div className="rounded-md border border-border p-4 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Registration</span>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Set a URL and open the status to show a <strong>Register</strong> button on the public event page.
          </p>

          <div className="space-y-2">
            <Label htmlFor="registrationUrl">Registration URL</Label>
            <Input
              id="registrationUrl"
              type="url"
              placeholder="https://lu.ma/your-event or https://eventbrite.com/…"
              value={form.registrationUrl ?? ""}
              onChange={(e) =>
                setForm({ ...form, registrationUrl: e.target.value || null })
              }
              data-testid="input-registrationUrl"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Registration status</Label>
              <Select
                value={form.registrationStatus || "UNKNOWN_REGISTRATION_STATUS"}
                onValueChange={(v) => setForm({ ...form, registrationStatus: v })}
              >
                <SelectTrigger data-testid="select-registrationStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">Open — show Register button</SelectItem>
                  <SelectItem value="OPEN_EXTERNAL">Open (External link)</SelectItem>
                  <SelectItem value="CLOSED_AUTOMATICALLY">Closed</SelectItem>
                  <SelectItem value="UNKNOWN_REGISTRATION_STATUS">Not set</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Event type</Label>
              <Select
                value={form.eventType ?? "RSVP"}
                onValueChange={(v) => setForm({ ...form, eventType: v })}
              >
                <SelectTrigger data-testid="select-eventType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RSVP">RSVP</SelectItem>
                  <SelectItem value="TICKETED">Ticketed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.registrationUrl &&
            (form.registrationStatus === "OPEN" || form.registrationStatus === "OPEN_EXTERNAL") && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                Register button will appear on the public event page.
                <a
                  href={form.registrationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-1 underline hover:text-foreground"
                >
                  Preview link <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
        </div>

        <div className="rounded-md border border-border p-4 space-y-3">
          <div className="flex items-start gap-3">
            <input
              id="featured"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={Boolean(form.featured)}
              onChange={(e) =>
                setForm({ ...form, featured: e.target.checked })
              }
              data-testid="checkbox-featured"
            />
            <div className="flex-1">
              <Label htmlFor="featured" className="cursor-pointer">
                Feature on home page
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                When on, this event appears as a candidate in the "From The Feed"
                home-page carousel. Syncs to the collateral library on save.
              </p>
            </div>
          </div>
          {form.featured && (
            <div className="space-y-2 pl-7">
              <Label htmlFor="featuredRank">Featured rank (lower first)</Label>
              <Input
                id="featuredRank"
                type="number"
                min={0}
                step={1}
                placeholder="Leave blank to sort by publish date"
                value={form.featuredRank ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setForm({ ...form, featuredRank: null });
                    return;
                  }
                  const n = Number.parseInt(raw, 10);
                  setForm({
                    ...form,
                    featuredRank: Number.isFinite(n) ? n : null,
                  });
                }}
                data-testid="input-featuredRank"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Event Recording</Label>
          <div className="flex items-start gap-3">
            <Film className="h-5 w-5 text-muted-foreground mt-2 shrink-0" />
            <div className="flex-1 space-y-2">
              <Select
                value={form.recordingVideoId ?? "__none__"}
                onValueChange={(v) =>
                  setForm({ ...form, recordingVideoId: v === "__none__" ? null : v })
                }
              >
                <SelectTrigger data-testid="select-recordingVideo">
                  <SelectValue placeholder="Link a published video as the recording" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No recording</SelectItem>
                  {videoOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title} ({v.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Attach a post-event recording from the video library. When set,
                the public event detail page embeds the player beneath the
                &ldquo;past event&rdquo; banner.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Speakers</Label>
          <div className="flex items-start gap-3">
            <Users className="h-5 w-5 text-muted-foreground mt-2 shrink-0" />
            <div className="flex-1 space-y-3">
              {speakerIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No speakers tagged yet. Add team members who are speaking or
                  appearing — they'll show on the public event page and the
                  event will surface on each speaker's bio.
                </p>
              ) : (
                <ul className="space-y-2">
                  {speakerIds.map((id, idx) => {
                    const info = speakerLookup.get(id);
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
                        data-testid={`speaker-row-${id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {info?.name ?? `Team member #${id}`}
                            {info && !info.active && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (inactive)
                              </span>
                            )}
                          </div>
                          {info?.jobTitle && (
                            <div className="text-xs text-muted-foreground truncate">
                              {info.jobTitle}
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={idx === 0}
                          onClick={() => moveSpeaker(id, -1)}
                          aria-label="Move up"
                          data-testid={`speaker-up-${id}`}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={idx === speakerIds.length - 1}
                          onClick={() => moveSpeaker(id, 1)}
                          aria-label="Move down"
                          data-testid={`speaker-down-${id}`}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSpeaker(id)}
                          aria-label="Remove speaker"
                          data-testid={`speaker-remove-${id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Select
                value="__add__"
                onValueChange={(v) => {
                  if (v === "__add__") return;
                  const n = Number.parseInt(v, 10);
                  if (Number.isFinite(n)) addSpeaker(n);
                }}
              >
                <SelectTrigger data-testid="select-add-speaker">
                  <SelectValue placeholder="Add a team member as speaker" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__add__">Add a speaker…</SelectItem>
                  {availableTeamMembers.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                      {m.jobTitle ? ` — ${m.jobTitle}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Order controls how speakers appear on the public event page —
                lower entries show first.
              </p>
            </div>
          </div>
        </div>

        {/* Session Schedule panel — only shown when editing an existing event */}
        {!isNew && (
          <div className="rounded-md border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Session Schedule</span>
                {sessions.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {sessions.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCsvFile(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => csvInputRef.current?.click()}
                  title="Import sessions from a CSV file with columns: title, sessionType, speakers, track, room, startTime, sessionUrl"
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Import CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSessions((prev) => [...prev, blankSession(prev.length)])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Row
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sessions are saved separately from event metadata. Use <strong>Save Schedule</strong> below to persist them. CSV columns: <code>title, sessionType, speakers, track, room, startTime, sessionUrl</code>.
            </p>

            {sessions.length > 0 ? (
              <div className="space-y-2">
                <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] text-xs font-medium text-muted-foreground gap-2 px-2">
                  <span>Title *</span>
                  <span>Type</span>
                  <span>Speakers</span>
                  <span>Room</span>
                  <span>Start time</span>
                  <span />
                </div>
                {sessions.map((sess, idx) => (
                  <div
                    key={sess._id}
                    className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-center rounded-md border border-border px-2 py-2"
                  >
                    <Input
                      placeholder="Session title"
                      value={sess.title}
                      className="h-8 text-sm"
                      onChange={(e) =>
                        setSessions((prev) =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, title: e.target.value } : s
                          )
                        )
                      }
                    />
                    <Input
                      placeholder="Talk / Panel…"
                      value={sess.sessionType ?? ""}
                      className="h-8 text-sm"
                      onChange={(e) =>
                        setSessions((prev) =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, sessionType: e.target.value || null } : s
                          )
                        )
                      }
                    />
                    <Input
                      placeholder="Jane Doe, …"
                      value={sess.speakers ?? ""}
                      className="h-8 text-sm"
                      onChange={(e) =>
                        setSessions((prev) =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, speakers: e.target.value || null } : s
                          )
                        )
                      }
                    />
                    <Input
                      placeholder="Main Stage"
                      value={sess.room ?? ""}
                      className="h-8 text-sm"
                      onChange={(e) =>
                        setSessions((prev) =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, room: e.target.value || null } : s
                          )
                        )
                      }
                    />
                    <Input
                      type="datetime-local"
                      value={
                        sess.startTime
                          ? toLocalInput(sess.startTime)
                          : ""
                      }
                      className="h-8 text-sm"
                      onChange={(e) =>
                        setSessions((prev) =>
                          prev.map((s, i) =>
                            i === idx
                              ? {
                                  ...s,
                                  startTime: e.target.value
                                    ? new Date(e.target.value).toISOString()
                                    : null,
                                }
                              : s
                          )
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        setSessions((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No sessions yet. Add rows manually or import from CSV.
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setSessionSaveStatus(null);
                  sessionsMutation.mutate();
                }}
                disabled={sessionsMutation.isPending}
              >
                {sessionsMutation.isPending ? "Saving…" : "Save Schedule"}
              </Button>
              {existing?.slug && sessions.length > 0 && (
                <a
                  href={`/events/${existing.slug}/schedule`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  View public schedule <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {sessionSaveStatus && (
                <span className="text-xs text-muted-foreground">{sessionSaveStatus}</span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Event Image</Label>
          <div className="flex items-center gap-4">
            <div className="w-32 h-32 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLibraryMode("any")}
                data-testid="button-pick-image"
              >
                {imagePreview ? "Change Image" : "Pick from Library"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLibraryMode("location")}
                data-testid="button-pick-location-image"
              >
                <MapPin className="h-4 w-4 mr-1" />
                Pick Location Image
              </Button>
              {imagePreview && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setForm({ ...form, imageAssetId: null, imageMediaId: null });
                    setImagePreview(null);
                  }}
                  data-testid="button-remove-image"
                >
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* SEO panel */}
        <div className="rounded-md border border-border p-4">
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                data-testid="seo-toggle"
              >
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">SEO</span>
                </div>
                <span className="text-xs text-muted-foreground">Click to expand</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 mt-4">
              <div className="space-y-2">
                <Label htmlFor="seoTitle">SEO Title</Label>
                <Input
                  id="seoTitle"
                  placeholder={form.title || "Override page title for search engines"}
                  value={form.seoTitle ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, seoTitle: e.target.value || null })
                  }
                  data-testid="input-seo-title"
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to the event title. Keep under 65 characters for best results.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="seoDescription">SEO Description</Label>
                <Textarea
                  id="seoDescription"
                  rows={2}
                  placeholder="Override meta description shown in search results"
                  value={form.seoDescription ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, seoDescription: e.target.value || null })
                  }
                  data-testid="input-seo-description"
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to teaser or description. Aim for 70–160 characters.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {error && (
          <div className="text-destructive text-sm" data-testid="text-form-error">{error}</div>
        )}

        <div className="flex items-center gap-3 pt-4">
          <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save">
            {saveMutation.isPending ? "Saving…" : isNew ? "Create Event" : "Save Changes"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/people/events")}>
            Cancel
          </Button>
          {!isNew && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSyncStatus(null);
                syncMutation.mutate();
              }}
              disabled={syncMutation.isPending}
              className="ml-auto"
              data-testid="button-sync-collateral"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {syncMutation.isPending ? "Syncing…" : "Sync to Collateral"}
            </Button>
          )}
        </div>
        {syncStatus && (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-sync-status"
          >
            {syncStatus}
          </div>
        )}
      </form>

      <MediaPickerModal
        open={libraryMode !== null}
        onClose={() => setLibraryMode(null)}
        onSelect={handleSelectMedia}
        selectedId={libraryMode === "location" ? null : form.imageMediaId ?? null}
        categorySlug={libraryMode === "location" ? "location" : undefined}
        kind="image"
      />
      <div className="mt-6">
        <ActivityTab entity="event" entityId={id} />
      </div>
      </div>
    </AdminLayout>
  );
}
