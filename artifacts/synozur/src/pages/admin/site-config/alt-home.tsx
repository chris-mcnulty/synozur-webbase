import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  api,
  type UpdateSiteSettingsBody,
  type HomeContent,
} from "@/lib/api";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import type { MediaItem } from "@workspace/api-client-react";
import { AltHomeSection } from "./_home-settings-helpers";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO = `${BASE_PATH}/images/hero-bg.png`;

type HcKey = keyof HomeContent;

interface HcField {
  key: HcKey;
  label: string;
  placeholder: string;
  multiline?: boolean;
}

interface HcGroup {
  title: string;
  hint?: string;
  fields: HcField[];
}

// Editable copy for the live home page (served at `/`). Each field maps 1:1 to
// a property on the `homeContent` JSON blob and falls back to the page's
// built-in default when left blank. Small repeated list items (checklists,
// metric cards, role items, phase cards) remain hard-coded in the page.
const HC_GROUPS: HcGroup[] = [
  {
    title: "Hero",
    hint: "The accent word is highlighted within the headline.",
    fields: [
      {
        key: "heroHeadline",
        label: "Headline",
        placeholder: "Become AI-first — before disruption decides for you.",
      },
      {
        key: "heroHeadlineAccent",
        label: "Headline accent word",
        placeholder: "AI-first",
      },
      {
        key: "heroSubheadline",
        label: "Subheadline",
        placeholder: "Synozur is the AI-native advisory firm…",
        multiline: true,
      },
      {
        key: "heroPrimaryCtaLabel",
        label: "Primary CTA label",
        placeholder: "Book the AI & North Star Sprint",
      },
      {
        key: "heroPrimaryCtaHref",
        label: "Primary CTA link",
        placeholder: "/book",
      },
      {
        key: "heroSecondaryCtaLabel",
        label: "Secondary CTA label",
        placeholder: "See proof, not promises",
      },
      {
        key: "heroSecondaryCtaHref",
        label: "Secondary CTA link",
        placeholder: "/proof",
      },
      {
        key: "heroLadderCaption",
        label: "Ladder caption",
        placeholder: "we install the model and prove the differential.",
      },
    ],
  },
  {
    title: "Pain",
    fields: [
      {
        key: "painHeadline",
        label: "Headline",
        placeholder: "The problem isn't AI. It's your operating model.",
      },
      {
        key: "painSubheadline",
        label: "Subheadline",
        placeholder: "Most firms deliver strategy…",
        multiline: true,
      },
      {
        key: "painCallout",
        label: "Callout",
        placeholder: "If your operating model doesn't adapt…",
        multiline: true,
      },
    ],
  },
  {
    title: "The Sprint",
    fields: [
      { key: "sprintEyebrow", label: "Eyebrow", placeholder: "The Front Door" },
      {
        key: "sprintHeadline",
        label: "Headline",
        placeholder: "The AI & North Star Sprint",
      },
      {
        key: "sprintBody",
        label: "Body",
        placeholder: "A 4–6 week executive engagement…",
        multiline: true,
      },
      {
        key: "sprintCtaLabel",
        label: "CTA label",
        placeholder: "Start the Sprint",
      },
      { key: "sprintCtaHref", label: "CTA link", placeholder: "/book" },
    ],
  },
  {
    title: "Proof",
    fields: [
      {
        key: "proofHeadline",
        label: "Headline",
        placeholder: "Proof, not promises",
      },
      {
        key: "proofLinkLabel",
        label: "Link label",
        placeholder: "View detailed case studies",
      },
      { key: "proofLinkHref", label: "Link", placeholder: "/case-studies" },
    ],
  },
  {
    title: "Who this is for",
    fields: [
      {
        key: "icpHeadline",
        label: "Headline",
        placeholder: "Who this is for",
      },
      {
        key: "icpHighlightLine1",
        label: "Highlight line 1",
        placeholder: "Mid-market. Privately held.",
      },
      {
        key: "icpHighlightLine2",
        label: "Highlight line 2",
        placeholder: "AI pressure is real — and time is limited.",
      },
      { key: "icpLinkLabel", label: "Link label", placeholder: "Why Synozur" },
      { key: "icpLinkHref", label: "Link", placeholder: "/about" },
    ],
  },
  {
    title: "What we are not",
    fields: [
      {
        key: "notHeadline",
        label: "Headline",
        placeholder: "What we are not",
      },
      {
        key: "notSubheadline",
        label: "Subheadline",
        placeholder: "We operate at the CEO and Board level…",
        multiline: true,
      },
    ],
  },
  {
    title: "AI, with judgment",
    fields: [
      {
        key: "judgmentHeadline",
        label: "Headline",
        placeholder: "AI, with judgment",
      },
      {
        key: "judgmentBody",
        label: "Body",
        placeholder: "AI accelerates our work…",
        multiline: true,
      },
      {
        key: "judgmentBadge",
        label: "Badge",
        placeholder: "No AI slop. Ever.",
      },
    ],
  },
  {
    title: "The North Star Method",
    fields: [
      {
        key: "methodHeadline",
        label: "Headline",
        placeholder: "The North Star Method™",
      },
      {
        key: "methodSubheadline",
        label: "Subheadline",
        placeholder: "Not theory. A repeatable system…",
        multiline: true,
      },
    ],
  },
];

const HC_KEYS: HcKey[] = HC_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

type HeroBackgroundType = "image" | "video";
type HomeRootVariant = "a" | "b";

export default function AdminAltHome() {
  const qc = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<
    null | "homeb-hero" | "homeb-video"
  >(null);
  const [hcDraft, setHcDraft] = useState<Record<HcKey, string> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
  });

  const draftFromData = (hc: HomeContent | null | undefined) => {
    const next = {} as Record<HcKey, string>;
    for (const k of HC_KEYS) next[k] = hc?.[k] ?? "";
    return next;
  };

  useEffect(() => {
    if (data && hcDraft === null) {
      setHcDraft(draftFromData(data.homeContent));
    }
  }, [data, hcDraft]);

  const currentHomeRootVariant: HomeRootVariant =
    (data?.homeRootVariant as HomeRootVariant | null | undefined) === "b"
      ? "b"
      : "a";

  const currentHeroBgType: HeroBackgroundType =
    (data?.homeHeroBackgroundType as HeroBackgroundType | null | undefined) ===
    "video"
      ? "video"
      : "image";

  const currentHomeBHeroBgType: HeroBackgroundType | null =
    data?.homeBHeroBackgroundType === "video"
      ? "video"
      : data?.homeBHeroBackgroundType === "image"
        ? "image"
        : null;

  // This page owns only the Alt Home fields. The only required field in
  // UpdateSiteSettingsBody is requireCookieConsent; all others are optional,
  // so we omit non-owned fields entirely and let the server keep their
  // current values. This avoids coupling to site-wide settings that are
  // managed on the Site Settings page.
  const buildPayload = (
    overrides: Partial<UpdateSiteSettingsBody>,
  ): UpdateSiteSettingsBody => ({
    requireCookieConsent: data?.requireCookieConsent ?? false,
    homeRootVariant: currentHomeRootVariant,
    homeBHeroBackgroundType: data?.homeBHeroBackgroundType ?? null,
    homeBHeroImageMediaId: data?.homeBHeroImageMediaId ?? null,
    homeBHeroVideoMediaId: data?.homeBHeroVideoMediaId ?? null,
    ...overrides,
  });

  const updateMutation = useMutation({
    mutationFn: (next: UpdateSiteSettingsBody) =>
      api.updateAdminSiteSettings(next),
    onSuccess: (result) => {
      qc.setQueryData(["admin-site-settings"], result);
      qc.invalidateQueries({ queryKey: ["public-site-settings"] });
      setHcDraft(draftFromData(result.homeContent));
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    },
  });

  const handlePickMedia = (m: MediaItem) => {
    if (pickerOpen === "homeb-hero") {
      updateMutation.mutate(buildPayload({ homeBHeroImageMediaId: m.id }));
    } else if (pickerOpen === "homeb-video") {
      updateMutation.mutate(buildPayload({ homeBHeroVideoMediaId: m.id }));
    }
    setPickerOpen(null);
  };

  return (
    <AdminLayout
      title="Alt Home"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Site Config" },
        { label: "Alt Home" },
      ]}
    >
      <p className="text-sm text-muted-foreground mb-8 max-w-3xl">
        Settings for the live home page (served at <code>/</code>) — hero
        background media and the core copy for every section. The original home
        page media is configured in{" "}
        <Link href="/site-config/site-settings" className="underline">
          Site Settings
        </Link>
        .
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {/* 1 ── Root variant status (fixed in code) */}
          <div className="rounded-md border border-border p-6 space-y-2">
            <h2 className="text-lg font-semibold mb-1">Homepage at /</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              The primary home experience is served at the root URL (
              <code>/</code>) and is fixed in code. The copy and hero background
              below apply to the live home page.
            </p>
          </div>

          {/* 2 ── Hero background media overrides */}
          <AltHomeSection
            heroUrl={data?.homeBHeroImageUrl ?? null}
            heroFallback={data?.homeHeroImageUrl ?? DEFAULT_HERO}
            heroVideoUrl={data?.homeBHeroVideoUrl ?? null}
            inheritedVideoUrl={data?.homeHeroVideoUrl ?? null}
            heroBgType={currentHomeBHeroBgType}
            inheritedHeroBgType={currentHeroBgType}
            onOpenHero={() => setPickerOpen("homeb-hero")}
            onOpenVideo={() => setPickerOpen("homeb-video")}
            onResetHero={() =>
              updateMutation.mutate(
                buildPayload({ homeBHeroImageMediaId: null }),
              )
            }
            onResetVideo={() =>
              updateMutation.mutate(
                buildPayload({ homeBHeroVideoMediaId: null }),
              )
            }
            onHeroBgTypeChange={(type) =>
              updateMutation.mutate(
                buildPayload({ homeBHeroBackgroundType: type }),
              )
            }
            disabled={updateMutation.isPending}
          />

          {/* 3 ── Editable copy */}
          <div className="rounded-md border border-border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Page copy</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Core copy for the live home page. Leave any field blank to fall
                back to the built-in default. Saving applies every field at
                once. Small repeated items (checklists, metric cards, role
                items, method phase cards) are managed in code.
              </p>
            </div>

            {hcDraft &&
              (() => {
                const set = (k: HcKey, v: string) =>
                  setHcDraft((prev) => (prev ? { ...prev, [k]: v } : prev));
                const isDirty = HC_KEYS.some(
                  (k) =>
                    (hcDraft[k] ?? "") !==
                    ((data?.homeContent?.[k] ?? "") as string),
                );
                const hasSaved = HC_KEYS.some(
                  (k) => (data?.homeContent?.[k] ?? null) !== null,
                );

                const renderInput = (f: HcField) => (
                  <div key={f.key} className="space-y-1">
                    <label
                      htmlFor={`input-${f.key}`}
                      className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
                    >
                      {f.label}
                    </label>
                    {f.multiline ? (
                      <textarea
                        id={`input-${f.key}`}
                        className="w-full min-h-[72px] rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={f.placeholder}
                        value={hcDraft[f.key]}
                        onChange={(e) => set(f.key, e.target.value)}
                        disabled={updateMutation.isPending}
                        data-testid={`input-${f.key}`}
                      />
                    ) : (
                      <Input
                        id={`input-${f.key}`}
                        placeholder={f.placeholder}
                        value={hcDraft[f.key]}
                        onChange={(e) => set(f.key, e.target.value)}
                        disabled={updateMutation.isPending}
                        data-testid={`input-${f.key}`}
                      />
                    )}
                  </div>
                );

                return (
                  <div className="space-y-6">
                    {HC_GROUPS.map((group, gi) => (
                      <div
                        key={group.title}
                        className={
                          gi === 0
                            ? "space-y-3"
                            : "space-y-3 border-t border-border pt-6"
                        }
                      >
                        <h3 className="text-sm font-semibold">{group.title}</h3>
                        {group.hint && (
                          <p className="text-xs text-muted-foreground">
                            {group.hint}
                          </p>
                        )}
                        <div className="grid gap-3 md:grid-cols-2">
                          {group.fields.map(renderInput)}
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center gap-2 border-t border-border pt-6">
                      <Button
                        onClick={() => {
                          const homeContent: Record<string, string | null> = {};
                          for (const k of HC_KEYS) {
                            const v = hcDraft[k].trim();
                            homeContent[k] = v.length > 0 ? v : null;
                          }
                          updateMutation.mutate(
                            buildPayload({
                              homeContent: homeContent as HomeContent,
                            }),
                          );
                        }}
                        disabled={updateMutation.isPending || !isDirty}
                        data-testid="button-save-home-b-copy"
                      >
                        Save copy
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setHcDraft(draftFromData(null));
                          updateMutation.mutate(
                            buildPayload({ homeContent: null }),
                          );
                        }}
                        disabled={updateMutation.isPending || !hasSaved}
                        data-testid="button-reset-home-b-copy"
                      >
                        <X className="h-4 w-4 mr-1" /> Reset all to defaults
                      </Button>
                    </div>
                  </div>
                );
              })()}
          </div>

          <div className="h-5 text-sm text-muted-foreground flex items-center gap-2">
            {showSaved && (
              <span
                className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                data-testid="text-saved-indicator"
              >
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            {updateMutation.isError && (
              <span className="text-destructive">
                Failed to save. Please try again.
              </span>
            )}
          </div>
        </div>
      )}

      <MediaPickerModal
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        onSelect={handlePickMedia}
        kind={pickerOpen === "homeb-video" ? "video" : "image"}
      />

      {showSaved && (
        <div aria-live="polite" className="sr-only" data-testid="aria-saved">
          Saved
        </div>
      )}
    </AdminLayout>
  );
}
