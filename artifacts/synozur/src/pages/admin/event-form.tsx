import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, ArrowLeft, X } from "lucide-react";
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
    description: null,
    registrationUrl: null,
    registrationStatus: "UNKNOWN_REGISTRATION_STATUS",
    eventType: "RSVP",
    status: "UPCOMING",
    imageAssetId: null,
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        description: existing.description,
        registrationUrl: existing.registrationUrl,
        registrationStatus: existing.registrationStatus,
        eventType: existing.eventType,
        status: existing.status,
        imageAssetId: existing.imageAssetId,
      });
      setImagePreview(existing.imageUrl ?? null);
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) return api.createEvent(form);
      return api.updateEvent(eventId!, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-events"] });
      qc.invalidateQueries({ queryKey: ["admin-event", eventId] });
      qc.invalidateQueries({ queryKey: ["public-events"] });
      navigate("/");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!isNew && isLoading) {
    return <div className="container mx-auto px-4 py-12">Loading…</div>;
  }

  const handleSelectAsset = (asset: Asset) => {
    setForm((f) => ({ ...f, imageAssetId: asset.id }));
    setImagePreview(`${BASE_PATH}/api/storage${asset.storageKey}`);
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <button
        onClick={() => navigate("/")}
        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to events
      </button>
      <h1 className="text-3xl font-bold mb-8">
        {isNew ? "Create Event" : "Edit Event"}
      </h1>

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
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={4}
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
                onClick={() => setShowLibrary(true)}
                data-testid="button-pick-image"
              >
                {imagePreview ? "Change Image" : "Pick from Library"}
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
          <Button type="button" variant="outline" onClick={() => navigate("/")}>
            Cancel
          </Button>
        </div>
      </form>

      <AssetLibraryModal
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={handleSelectAsset}
        selectedId={form.imageAssetId}
      />
    </div>
  );
}
