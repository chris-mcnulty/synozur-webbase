import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Trash2,
  Plus,
  Upload,
  Calendar,
  Star,
  FileText,
  Check,
  X,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Descriptions that were auto-drafted by the seed (Task 489).
// Used to badge rows whose admin hasn't yet touched the SEO copy.
const SEEDED_DESCRIPTIONS: Record<string, string> = {
  "ai-driven-gtm-how-to-assess-rebuild-and-accelerate-your-2026-plans":
    "Webinar: assess your go-to-market, rebuild your funnel with AI, and accelerate your 2026 plans — practical agentic GTM strategies from Synozur.",
  "the-new-ai-frontier-market-shifts-maturity-gaps-and-how-to-lead-with-copilot":
    "Webinar: explore AI market shifts, close maturity gaps, and lead your organization with Microsoft Copilot — insights from Synozur strategists.",
  "m365-community-days-dc-2026":
    "Join Synozur at M365 Community Days DC 2026 in Arlington, VA — community-led sessions on Microsoft 365, Copilot, and the modern digital workplace.",
  "partner-vibe":
    "Synozur at Partner Vibe on South Padre Island — Microsoft partner leaders sharing strategies for growth, AI, and co-selling in 2026.",
  "strategy-now-with-ai-building-your-company-operating-system-for-2026-success":
    "Webinar: build your Company Operating System for 2026 — align strategy, culture, and AI into one operating rhythm with Synozur's North Star Method.",
  "experts-live-us":
    "Synozur at Experts Live US in New York City — expert-led sessions on Microsoft cloud, AI, and automation for IT pros and technology leaders.",
  "vancouver-ai-summit":
    "Join Synozur at the Vancouver AI Summit — practical sessions on AI adoption, governance, and real-world results for business and technology leaders.",
  "microsoft-ignite":
    "Meet Synozur at Microsoft Ignite in San Francisco — Microsoft's flagship conference for AI, Copilot, security, and cloud innovation.",
  "techcon-365-dallas":
    "Join Synozur at TechCon 365 Dallas — Microsoft 365, Power Platform, and Copilot training with deep-dive workshops and expert-led sessions.",
  "fy26-forward-microsoft-partner-success-strategies":
    "Webinar: FY26 Microsoft partner success strategies — navigate program changes, sharpen your co-sell motion, and plan for growth with Synozur.",
  "business-strategy-masterclass":
    "A hands-on masterclass on business strategy fundamentals — vision, differentiation, and execution — led by Synozur's strategy practitioners.",
  "mastering-your-ai-rollout-success-strategies":
    "Webinar: proven strategies for a successful AI rollout — adoption planning, governance, and change management guidance from Synozur experts.",
  "m365-philly-2025":
    "Join Synozur at M365 Philly 2025 in Malvern, PA — free community sessions on Microsoft 365, SharePoint, Teams, and Copilot for practitioners.",
  "ai-im-summit":
    "Synozur at the AIIM AI+IM Summit in Atlanta — where information management meets AI: governance, unstructured data, and intelligent automation.",
  "how-to-succeed-with-your-copilot-rollout":
    "Webinar: how to succeed with your Microsoft Copilot rollout — readiness, adoption, and measurement practices that make AI stick, from Synozur.",
  "techcon-365-seattle":
    "Join Synozur at TechCon 365 Seattle — Microsoft 365, SharePoint, Teams, and Copilot sessions and workshops for IT pros and business users.",
  "microsoft-365-community-conference":
    "Meet Synozur at the Microsoft 365 Community Conference in Las Vegas — hundreds of sessions on Copilot, Teams, SharePoint, and Viva.",
  "transforming-the-digital-workplace-strategies-for-engagement-and-success":
    "Webinar: strategies for digital workplace transformation — employee engagement, intranet success, and adoption insights from Synozur.",
};

function isSeededDescription(slug: string, desc: string | null | undefined): boolean {
  if (!desc) return false;
  return SEEDED_DESCRIPTIONS[slug] === desc;
}

/** Returns Tailwind classes for a description length indicator dot. */
function descLengthClass(desc: string | null | undefined): string {
  const len = (desc ?? "").trim().length;
  if (len === 0) return "bg-destructive";
  if (len < 70 || len > 160) return "bg-amber-500";
  return "bg-emerald-500";
}

function descLengthLabel(desc: string | null | undefined): string {
  const len = (desc ?? "").trim().length;
  if (len === 0) return "Missing";
  if (len < 70) return `${len} chars — too short`;
  if (len > 160) return `${len} chars — too long`;
  return `${len} chars`;
}

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    UPCOMING: "bg-emerald-500/15 text-emerald-400",
    ENDED: "bg-muted text-muted-foreground",
    CANCELLED: "bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={`text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded ${map[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

type AdminEvent = Awaited<ReturnType<typeof api.adminEvents>>[number];

/** Inline SEO description editor row shown in SEO Review mode. */
function SeoRow({
  event,
  onSaved,
}: {
  event: AdminEvent;
  onSaved: (updated: AdminEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(event.seoDescription ?? "");
  const seeded = isSeededDescription(event.slug, event.seoDescription);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patchEventSeoDescription(event.id, draft.trim() || null),
    onSuccess: (updated) => {
      setEditing(false);
      onSaved(updated);
    },
  });

  function handleEdit() {
    setDraft(event.seoDescription ?? "");
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setDraft(event.seoDescription ?? "");
  }

  const charCount = draft.trim().length;
  const charClass =
    charCount === 0
      ? "text-destructive"
      : charCount < 70 || charCount > 160
        ? "text-amber-500"
        : "text-emerald-500";

  return (
    <div
      className="px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border last:border-0"
      data-testid={`seo-row-${event.id}`}
    >
      {/* Event header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{event.title}</span>
            {event.featured && (
              <Star
                className="h-3.5 w-3.5 text-amber-400 shrink-0"
                aria-label="Featured"
              />
            )}
            {seeded && !editing && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 shrink-0">
                Auto-drafted
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDate(event.startDate)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
        <div className="hidden sm:block shrink-0">{statusBadge(event.status)}</div>
        {!editing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleEdit}
            data-testid={`seo-edit-${event.id}`}
            title="Edit SEO description"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Description area */}
      {editing ? (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a meta description (70–160 characters)…"
            autoFocus
            data-testid={`seo-textarea-${event.id}`}
          />
          <div className="flex items-center justify-between">
            <span className={`text-xs tabular-nums ${charClass}`}>
              {charCount === 0
                ? "No description"
                : charCount < 70
                  ? `${charCount} chars — too short (70–160)`
                  : charCount > 160
                    ? `${charCount} chars — too long (max 160)`
                    : `${charCount} chars ✓`}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleCancel}
                disabled={saveMutation.isPending}
                data-testid={`seo-cancel-${event.id}`}
              >
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid={`seo-save-${event.id}`}
              >
                <Check className="h-3 w-3 mr-1" />
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          {saveMutation.isError && (
            <p className="text-xs text-destructive">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : "Save failed"}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span
            className={`mt-1 h-2 w-2 rounded-full shrink-0 ${descLengthClass(event.seoDescription)}`}
            title={descLengthLabel(event.seoDescription)}
          />
          {event.seoDescription ? (
            <p
              className="text-sm text-muted-foreground leading-snug cursor-pointer hover:text-foreground transition-colors"
              onClick={handleEdit}
              title="Click to edit"
            >
              {event.seoDescription}
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground/50 italic cursor-pointer hover:text-muted-foreground transition-colors"
              onClick={handleEdit}
            >
              No SEO description — click to add one
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminEventsList() {
  const qc = useQueryClient();
  const [seoMode, setSeoMode] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["admin-events"],
    queryFn: () => api.adminEvents(),
    select: (data) =>
      [...data].sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-events"] }),
  });

  const [seedResult, setSeedResult] = useState<string | null>(null);
  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE_PATH}/api/admin/seed-events`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ inserted: number; skipped: number }>;
    },
    onSuccess: (data) => {
      setSeedResult(`Done — ${data.inserted} inserted, ${data.skipped} skipped.`);
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (err: unknown) =>
      setSeedResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });

  /** Merge a saved event back into the query cache without a full refetch. */
  function handleSeoSaved(updated: AdminEvent) {
    qc.setQueryData<AdminEvent[]>(["admin-events"], (prev) =>
      prev
        ? prev.map((e) => (e.id === updated.id ? updated : e))
        : [updated],
    );
  }

  // Stats for the SEO mode header
  const missingCount = events.filter((e) => !(e.seoDescription ?? "").trim()).length;
  const seededCount = events.filter((e) =>
    isSeededDescription(e.slug, e.seoDescription),
  ).length;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {events.length} event{events.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={seoMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => setSeoMode((v) => !v)}
            data-testid="button-seo-review"
          >
            <FileText className="h-4 w-4 mr-1.5" />
            SEO Review
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  "Seed events from the CSV export? Existing slugs will be updated.",
                )
              ) {
                seedMutation.mutate();
              }
            }}
            disabled={seedMutation.isPending}
            data-testid="button-seed-events"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            {seedMutation.isPending ? "Seeding…" : "Seed from CSV"}
          </Button>
          <Link href="/people/events/new">
            <Button size="sm" data-testid="button-new-event">
              <Plus className="h-4 w-4 mr-1.5" /> New Event
            </Button>
          </Link>
        </div>
      </div>

      {seedResult && (
        <div className="mb-4 px-4 py-2 rounded-md bg-muted text-sm text-muted-foreground flex items-center justify-between">
          <span>{seedResult}</span>
          <button
            onClick={() => setSeedResult(null)}
            className="ml-4 text-xs underline hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Calendar className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No events yet.</p>
        </div>
      ) : seoMode ? (
        /* ── SEO Review mode ─────────────────────────────────────────── */
        <div>
          {/* Summary strip */}
          <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{events.length}</span> events
            </span>
            {missingCount > 0 && (
              <span className="text-destructive font-medium">
                {missingCount} missing description{missingCount !== 1 ? "s" : ""}
              </span>
            )}
            {seededCount > 0 && (
              <span className="text-violet-400">
                {seededCount} auto-drafted — review recommended
              </span>
            )}
            <span className="flex items-center gap-2 ml-auto">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> 70–160 chars
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Too short/long
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-destructive" /> Missing
              </span>
            </span>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            {events.map((e) => (
              <SeoRow key={e.id} event={e} onSaved={handleSeoSaved} />
            ))}
          </div>
        </div>
      ) : (
        /* ── Normal list mode ────────────────────────────────────────── */
        <div className="rounded-xl border border-border overflow-hidden">
          {events.map((e, idx) => (
            <div
              key={e.id}
              data-testid={`row-event-${e.id}`}
              className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors ${idx !== events.length - 1 ? "border-b border-border" : ""}`}
            >
              {/* Thumbnail */}
              <div className="w-16 h-12 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                {e.imageUrl ? (
                  <img
                    src={e.imageUrl}
                    alt={e.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Calendar className="h-5 w-5 text-muted-foreground/40" />
                )}
              </div>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{e.title}</p>
                  {e.featured && (
                    <Star
                      className="h-3.5 w-3.5 text-amber-400 shrink-0"
                      aria-label="Featured"
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(e.startDate)}
                  {e.location ? ` · ${e.location}` : ""}
                </p>
              </div>

              {/* Status */}
              <div className="hidden sm:block shrink-0">
                {statusBadge(e.status)}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Link href={`/people/events/${e.id}`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    data-testid={`button-edit-${e.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete event "${e.title}"? This will remove it from the public site.`,
                      )
                    ) {
                      deleteMutation.mutate(e.id);
                    }
                  }}
                  data-testid={`button-delete-${e.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
