import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, X, RefreshCw, MapPin, Film } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
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
import { api } from "@/lib/api";
import { AssetLibraryModal } from "@/components/admin/AssetLibraryModal";
import type { Asset, EventInput } from "@workspace/api-zod/types";

interface Props {
  id?: string;
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

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
    recordingVideoId: null,
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [libraryMode, setLibraryMode] = useState<"any" | "location" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["admin-event", eventId],
    queryFn: () => api.getEvent(eventId!),
    enabled: eventId != null,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        title: existing.title,
        slug: existing.slug,
        startDate: existing.startDate,
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
        recordingVideoId: existing.recordingVideoId ?? null,
      });
      setImagePreview(existing.imageUrl ?? null);
    }
  }, [existing]);

  const videosQ = useQuery({
    queryKey: ["admin-videos-for-event"],
    queryFn: () => api.adminListVideos(),
  });
  const videoOptions = useMemo(() => {
    const items = videosQ.data?.items ?? [];
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

  const handleSelectAsset = (asset: Asset) => {
    setForm((f) => ({ ...f, imageAssetId: asset.id }));
    setImagePreview(`${BASE_PATH}/api/storage${asset.storageKey}`);
  };

  return (
    <AdminLayout title={title} crumbs={crumbs}>
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
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={form.location ?? ""}
            onChange={(e) => setForm({ ...form, location: e.target.value || null })}
            data-testid="input-location"
          />
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
          <Label htmlFor="registrationUrl">Registration URL</Label>
          <Input
            id="registrationUrl"
            type="url"
            value={form.registrationUrl ?? ""}
            onChange={(e) =>
              setForm({ ...form, registrationUrl: e.target.value || null })
            }
            data-testid="input-registrationUrl"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.status ?? "UPCOMING"}
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
          <div className="space-y-2">
            <Label>Event Type</Label>
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
          <div className="space-y-2">
            <Label>Registration</Label>
            <Select
              value={form.registrationStatus ?? "UNKNOWN_REGISTRATION_STATUS"}
              onValueChange={(v) => setForm({ ...form, registrationStatus: v })}
            >
              <SelectTrigger data-testid="select-registrationStatus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="OPEN_EXTERNAL">Open (External)</SelectItem>
                <SelectItem value="CLOSED_AUTOMATICALLY">Closed</SelectItem>
                <SelectItem value="UNKNOWN_REGISTRATION_STATUS">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
                    setForm({ ...form, imageAssetId: null });
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

      <AssetLibraryModal
        open={libraryMode !== null}
        onClose={() => setLibraryMode(null)}
        onSelect={handleSelectAsset}
        selectedId={libraryMode === "location" ? null : form.imageAssetId}
        category={libraryMode === "location" ? "location" : undefined}
      />
      </div>
    </AdminLayout>
  );
}
