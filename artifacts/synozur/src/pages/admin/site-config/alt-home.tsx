import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { api, type UpdateSiteSettingsBody } from "@/lib/api";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import type { MediaItem } from "@workspace/api-client-react";
import { AltHomeSection } from "./_home-settings-helpers";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO = `${BASE_PATH}/images/hero-bg.png`;

type HomeBKey =
  | "homeBHeroHeadlinePrefix"
  | "homeBHeroHeadlineAccent"
  | "homeBHeroHeadlineSuffix"
  | "homeBHeroSubheadline"
  | "homeBPillarsEyebrow"
  | "homeBPillarsHeadline"
  | "homeBPillar1Headline"
  | "homeBPillar1Body"
  | "homeBPillar2Headline"
  | "homeBPillar2Body"
  | "homeBPillar3Headline"
  | "homeBPillar3Body"
  | "homeBPillar4Headline"
  | "homeBPillar4Body"
  | "homeBClosingEyebrow"
  | "homeBClosingHeadline"
  | "homeBClosingBody";

const HOME_B_KEYS: HomeBKey[] = [
  "homeBHeroHeadlinePrefix",
  "homeBHeroHeadlineAccent",
  "homeBHeroHeadlineSuffix",
  "homeBHeroSubheadline",
  "homeBPillarsEyebrow",
  "homeBPillarsHeadline",
  "homeBPillar1Headline",
  "homeBPillar1Body",
  "homeBPillar2Headline",
  "homeBPillar2Body",
  "homeBPillar3Headline",
  "homeBPillar3Body",
  "homeBPillar4Headline",
  "homeBPillar4Body",
  "homeBClosingEyebrow",
  "homeBClosingHeadline",
  "homeBClosingBody",
];

type HeroBackgroundType = "image" | "video";
type HomeRootVariant = "a" | "b";

export default function AdminAltHome() {
  const qc = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<null | "homeb-hero" | "homeb-video">(null);
  const [homeBDraft, setHomeBDraft] = useState<Record<HomeBKey, string> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
  });

  useEffect(() => {
    if (data && homeBDraft === null) {
      const next = {} as Record<HomeBKey, string>;
      for (const k of HOME_B_KEYS) next[k] = data[k] ?? "";
      setHomeBDraft(next);
    }
  }, [data, homeBDraft]);

  const currentHomeRootVariant: HomeRootVariant =
    (data?.homeRootVariant as HomeRootVariant | null | undefined) === "b" ? "b" : "a";

  const currentHeroBgType: HeroBackgroundType =
    (data?.homeHeroBackgroundType as HeroBackgroundType | null | undefined) === "video"
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
  const buildPayload = (overrides: Partial<UpdateSiteSettingsBody>): UpdateSiteSettingsBody => ({
    requireCookieConsent: data?.requireCookieConsent ?? false,
    homeRootVariant: currentHomeRootVariant,
    homeBHeroBackgroundType: data?.homeBHeroBackgroundType ?? null,
    homeBHeroImageMediaId: data?.homeBHeroImageMediaId ?? null,
    homeBHeroVideoMediaId: data?.homeBHeroVideoMediaId ?? null,
    homeBHeroHeadlinePrefix: data?.homeBHeroHeadlinePrefix ?? null,
    homeBHeroHeadlineAccent: data?.homeBHeroHeadlineAccent ?? null,
    homeBHeroHeadlineSuffix: data?.homeBHeroHeadlineSuffix ?? null,
    homeBHeroSubheadline: data?.homeBHeroSubheadline ?? null,
    homeBPillarsEyebrow: data?.homeBPillarsEyebrow ?? null,
    homeBPillarsHeadline: data?.homeBPillarsHeadline ?? null,
    homeBPillar1Headline: data?.homeBPillar1Headline ?? null,
    homeBPillar1Body: data?.homeBPillar1Body ?? null,
    homeBPillar2Headline: data?.homeBPillar2Headline ?? null,
    homeBPillar2Body: data?.homeBPillar2Body ?? null,
    homeBPillar3Headline: data?.homeBPillar3Headline ?? null,
    homeBPillar3Body: data?.homeBPillar3Body ?? null,
    homeBPillar4Headline: data?.homeBPillar4Headline ?? null,
    homeBPillar4Body: data?.homeBPillar4Body ?? null,
    homeBClosingEyebrow: data?.homeBClosingEyebrow ?? null,
    homeBClosingHeadline: data?.homeBClosingHeadline ?? null,
    homeBClosingBody: data?.homeBClosingBody ?? null,
    ...overrides,
  });

  const updateMutation = useMutation({
    mutationFn: (next: UpdateSiteSettingsBody) => api.updateAdminSiteSettings(next),
    onSuccess: (result) => {
      qc.setQueryData(["admin-site-settings"], result);
      qc.invalidateQueries({ queryKey: ["public-site-settings"] });
      const nextHomeB = {} as Record<HomeBKey, string>;
      for (const k of HOME_B_KEYS) nextHomeB[k] = result[k] ?? "";
      setHomeBDraft(nextHomeB);
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
        Settings for the alternate home page (
        <Link href="/home-b" className="underline">
          /home-b
        </Link>
        ), which is now the primary home served at <code>/</code> — hero media
        overrides and editable copy. The original home page media is configured in{" "}
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
            <h2 className="text-lg font-semibold mb-1">Homepage variant at /</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              The primary home experience (<strong>Alt Home / B</strong>) is now served
              at the root URL (<code>/</code>) and is fixed in code. The original home
              page is parked at <code>/home-a</code> for reference and is no longer linked
              from the site navigation. The copy and hero media below still apply to the
              live home page.
            </p>
          </div>

          {/* 2 ── Hero media overrides */}
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
              updateMutation.mutate(buildPayload({ homeBHeroImageMediaId: null }))
            }
            onResetVideo={() =>
              updateMutation.mutate(buildPayload({ homeBHeroVideoMediaId: null }))
            }
            onHeroBgTypeChange={(type) =>
              updateMutation.mutate(buildPayload({ homeBHeroBackgroundType: type }))
            }
            disabled={updateMutation.isPending}
          />

          {/* 3 ── Editable copy */}
          <div className="rounded-md border border-border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Page copy</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Editable copy for the alternate home page. Leave any field blank to fall
                back to the built-in default. Saving applies to all 17 fields at once.
              </p>
            </div>

            {homeBDraft && (() => {
              const set = (k: HomeBKey, v: string) =>
                setHomeBDraft((prev) => (prev ? { ...prev, [k]: v } : prev));
              const isDirty = HOME_B_KEYS.some(
                (k) => (homeBDraft[k] ?? "") !== ((data?.[k] ?? "") as string),
              );
              const renderInput = (
                key: HomeBKey,
                label: string,
                placeholder: string,
                multiline = false,
              ) => (
                <div key={key} className="space-y-1">
                  <label
                    htmlFor={`input-${key}`}
                    className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
                  >
                    {label}
                  </label>
                  {multiline ? (
                    <textarea
                      id={`input-${key}`}
                      className="w-full min-h-[72px] rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={placeholder}
                      value={homeBDraft[key]}
                      onChange={(e) => set(key, e.target.value)}
                      disabled={updateMutation.isPending}
                      data-testid={`input-${key}`}
                    />
                  ) : (
                    <Input
                      id={`input-${key}`}
                      placeholder={placeholder}
                      value={homeBDraft[key]}
                      onChange={(e) => set(key, e.target.value)}
                      disabled={updateMutation.isPending}
                      data-testid={`input-${key}`}
                    />
                  )}
                </div>
              );

              return (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Hero</h3>
                    <p className="text-xs text-muted-foreground">
                      Headline renders as <em>prefix</em> + accented <em>accent</em> +{" "}
                      <em>suffix</em>.
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      {renderInput("homeBHeroHeadlinePrefix", "Headline prefix", "The")}
                      {renderInput("homeBHeroHeadlineAccent", "Headline accent", "Transformation")}
                      {renderInput("homeBHeroHeadlineSuffix", "Headline suffix", "Company")}
                    </div>
                    {renderInput(
                      "homeBHeroSubheadline",
                      "Subheadline",
                      "Built tools, models, and methods…",
                      true,
                    )}
                  </div>

                  <div className="space-y-3 border-t border-border pt-6">
                    <h3 className="text-sm font-semibold">Pillars section</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {renderInput("homeBPillarsEyebrow", "Eyebrow", "How we work")}
                      {renderInput("homeBPillarsHeadline", "Section headline", "A disciplined approach…")}
                    </div>
                    {([1, 2, 3, 4] as const).map((n) => (
                      <div
                        key={n}
                        className="space-y-2 rounded-md border border-border/60 p-4"
                      >
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Pillar {n}
                        </h4>
                        {renderInput(
                          `homeBPillar${n}Headline` as HomeBKey,
                          "Headline",
                          "Pillar headline",
                        )}
                        {renderInput(
                          `homeBPillar${n}Body` as HomeBKey,
                          "Body",
                          "Supporting paragraph for this pillar…",
                          true,
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 border-t border-border pt-6">
                    <h3 className="text-sm font-semibold">Closing call to action</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {renderInput("homeBClosingEyebrow", "Eyebrow", "Ready to begin")}
                      {renderInput(
                        "homeBClosingHeadline",
                        "Headline",
                        "Every engagement starts with a real conversation.",
                      )}
                    </div>
                    {renderInput(
                      "homeBClosingBody",
                      "Body",
                      "If you're navigating a market shift…",
                      true,
                    )}
                  </div>

                  <div className="flex items-center gap-2 border-t border-border pt-6">
                    <Button
                      onClick={() => {
                        const overrides: Partial<UpdateSiteSettingsBody> = {};
                        for (const k of HOME_B_KEYS) {
                          const v = homeBDraft[k].trim();
                          (overrides as Record<HomeBKey, string | null>)[k] =
                            v.length > 0 ? v : null;
                        }
                        updateMutation.mutate(buildPayload(overrides));
                      }}
                      disabled={updateMutation.isPending || !isDirty}
                      data-testid="button-save-home-b-copy"
                    >
                      Save copy
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const reset = {} as Record<HomeBKey, string>;
                        for (const k of HOME_B_KEYS) reset[k] = "";
                        setHomeBDraft(reset);
                        const overrides: Partial<UpdateSiteSettingsBody> = {};
                        for (const k of HOME_B_KEYS) {
                          (overrides as Record<HomeBKey, string | null>)[k] = null;
                        }
                        updateMutation.mutate(buildPayload(overrides));
                      }}
                      disabled={
                        updateMutation.isPending ||
                        HOME_B_KEYS.every((k) => (data?.[k] ?? null) === null)
                      }
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
              <span className="text-destructive">Failed to save. Please try again.</span>
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

      {/* Floating save indicator for the copy section (shown via showSaved above) */}
      {showSaved && (
        <div
          aria-live="polite"
          className="sr-only"
          data-testid="aria-saved"
        >
          Saved
        </div>
      )}

    </AdminLayout>
  );
}
