import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { api, BOOKING_SCOPES, type BookingInput } from "@/lib/api";

interface Props {
  id?: string;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export default function BookingForm({ id }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isNew = !id;

  const [form, setForm] = useState<BookingInput>({
    slug: "",
    title: "",
    teaser: null,
    descriptionHtml: null,
    embedUrl: "",
    scope: "general",
    startsAt: null,
    endsAt: null,
    displayOrder: 0,
    active: true,
    seoTitle: null,
    seoDescription: null,
    msBusinessId: null,
    msDefaultServiceId: null,
  });
  const [error, setError] = useState<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["admin-booking", id],
    queryFn: () => api.adminGetBooking(id!),
    enabled: id != null,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        slug: existing.slug,
        title: existing.title,
        teaser: existing.teaser,
        descriptionHtml: existing.descriptionHtml,
        embedUrl: existing.embedUrl,
        scope: (existing.scope as BookingInput["scope"]) ?? "general",
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        displayOrder: existing.displayOrder,
        active: existing.active,
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        msBusinessId: existing.msBusinessId,
        msDefaultServiceId: existing.msDefaultServiceId,
      });
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: () => (isNew ? api.createBooking(form) : api.updateBooking(id!, form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-bookings"] });
      qc.invalidateQueries({ queryKey: ["admin-booking", id] });
      qc.invalidateQueries({ queryKey: ["public-bookings"] });
      navigate("/people/bookings");
    },
    onError: (e: Error) => setError(e.message),
  });

  const title = isNew ? "Create Booking" : "Edit Booking";
  const crumbs = [
    { label: "Admin", href: "/" },
    { label: "Bookings", href: "/people/bookings" },
    { label: title },
  ];

  if (!isNew && isLoading) {
    return (
      <AdminLayout title={title} crumbs={crumbs}>
        <div className="text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }

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
              placeholder="e.g. north-star-workshop, ignite-2026"
              data-testid="input-slug"
            />
            <p className="text-xs text-muted-foreground">
              Public URL: <code>/start/{form.slug || "<slug>"}</code>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="embedUrl">Microsoft Bookings URL *</Label>
            <Input
              id="embedUrl"
              type="url"
              required
              placeholder="https://outlook.office365.com/owa/calendar/.../bookings/"
              value={form.embedUrl}
              onChange={(e) => setForm({ ...form, embedUrl: e.target.value })}
              data-testid="input-embedUrl"
            />
            <p className="text-xs text-muted-foreground">
              Paste the calendar URL from the Microsoft Bookings <em>Share</em>{" "}
              dialog (the same one used inside <code>&lt;iframe src=…&gt;</code>).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="teaser">Teaser</Label>
            <Textarea
              id="teaser"
              rows={2}
              placeholder="One or two sentences shown on the /start card."
              value={form.teaser ?? ""}
              onChange={(e) =>
                setForm({ ...form, teaser: e.target.value || null })
              }
              data-testid="input-teaser"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descriptionHtml">Description (HTML)</Label>
            <Textarea
              id="descriptionHtml"
              rows={5}
              placeholder="Optional copy shown above the embed on /start/<slug>."
              value={form.descriptionHtml ?? ""}
              onChange={(e) =>
                setForm({ ...form, descriptionHtml: e.target.value || null })
              }
              data-testid="input-descriptionHtml"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={form.scope ?? "general"}
                onValueChange={(v) =>
                  setForm({ ...form, scope: v as BookingInput["scope"] })
                }
              >
                <SelectTrigger data-testid="select-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOOKING_SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayOrder">Display order (lower first)</Label>
              <Input
                id="displayOrder"
                type="number"
                min={0}
                step={1}
                value={form.displayOrder ?? 0}
                onChange={(e) =>
                  setForm({
                    ...form,
                    displayOrder: Number.parseInt(e.target.value, 10) || 0,
                  })
                }
                data-testid="input-displayOrder"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startsAt">Visible from (optional)</Label>
              <Input
                id="startsAt"
                type="datetime-local"
                value={toLocalInput(form.startsAt ?? null)}
                onChange={(e) =>
                  setForm({ ...form, startsAt: fromLocalInput(e.target.value) })
                }
                data-testid="input-startsAt"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endsAt">Hidden after (optional)</Label>
              <Input
                id="endsAt"
                type="datetime-local"
                value={toLocalInput(form.endsAt ?? null)}
                onChange={(e) =>
                  setForm({ ...form, endsAt: fromLocalInput(e.target.value) })
                }
                data-testid="input-endsAt"
              />
            </div>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="flex items-start gap-3">
              <input
                id="active"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.active ?? true}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                data-testid="checkbox-active"
              />
              <div className="flex-1">
                <Label htmlFor="active" className="cursor-pointer">
                  Active
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  When off, the booking is hidden from <code>/start</code> and
                  the per-slug page returns 404 — even inside its time window.
                </p>
              </div>
            </div>
          </div>

          <fieldset className="rounded-md border border-border p-4 space-y-4">
            <legend className="px-1 text-xs uppercase tracking-widest text-muted-foreground">
              Native (Microsoft Graph) — optional
            </legend>
            <p className="text-xs text-muted-foreground">
              When the site-level <em>Bookings render mode</em> is set to{" "}
              <strong>native</strong>, bookings with a Microsoft Graph business
              id render an on-brand React flow instead of the iframe. Leave
              both blank to always render this booking via the iframe (even in
              native mode).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="msBusinessId">Bookings business id</Label>
                <Input
                  id="msBusinessId"
                  placeholder="e.g. NorthStar@contoso.onmicrosoft.com or a GUID"
                  value={form.msBusinessId ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, msBusinessId: e.target.value || null })
                  }
                  data-testid="input-msBusinessId"
                />
                <p className="text-xs text-muted-foreground">
                  The path segment after{" "}
                  <code>/solutions/bookingBusinesses/</code> in Microsoft Graph.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="msDefaultServiceId">Default service id (optional)</Label>
                <Input
                  id="msDefaultServiceId"
                  placeholder="Pre-select a service when the business has more than one"
                  value={form.msDefaultServiceId ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      msDefaultServiceId: e.target.value || null,
                    })
                  }
                  data-testid="input-msDefaultServiceId"
                />
              </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="seoTitle">SEO title</Label>
              <Input
                id="seoTitle"
                value={form.seoTitle ?? ""}
                onChange={(e) =>
                  setForm({ ...form, seoTitle: e.target.value || null })
                }
                data-testid="input-seoTitle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seoDescription">SEO description</Label>
              <Input
                id="seoDescription"
                value={form.seoDescription ?? ""}
                onChange={(e) =>
                  setForm({ ...form, seoDescription: e.target.value || null })
                }
                data-testid="input-seoDescription"
              />
            </div>
          </div>

          {error && (
            <div className="text-destructive text-sm" data-testid="text-form-error">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-4">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              data-testid="button-save"
            >
              {saveMutation.isPending
                ? "Saving…"
                : isNew
                ? "Create Booking"
                : "Save Changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/people/bookings")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
