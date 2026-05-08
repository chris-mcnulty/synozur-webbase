import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, X } from "lucide-react";
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

  // Build a full payload that passes through all fields the site-settings page
  // owns, so a save here doesn't accidentally null out site-wide settings.
  const buildPayload = (overrides: Partial<UpdateSiteSettingsBody>): UpdateSiteSettingsBody => ({
    // Fields this page owns — use current data or overrides
    homeRootVariant: (data?.homeRootVariant as HomeRootVariant | null | undefined) ?? "a",
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
    // Pass through site-settings-owned fields unchanged
    requireCookieConsent: data?.requireCookieConsent ?? false,
    siteTheme: data?.siteTheme ?? "cosmic",
    bookingsRenderMode: data?.bookingsRenderMode ?? "iframe",
    homeHeroBackgroundType: (data?.homeHeroBackgroundType as HeroBackgroundType | null | undefined) ?? "image",
    homeHeroImageAssetId: data?.homeHeroImageAssetId ?? null,
    homeHeroImageMediaId: data?.homeHeroImageMediaId ?? null,
    homeHeroVideoAssetId: data?.homeHeroVideoAssetId ?? null,
    homeHeroVideoMediaId: data?.homeHeroVideoMediaId ?? null,
    homeEditorialImageAssetId: data?.homeEditorialImageAssetId ?? null,
    homeEditorialImageMediaId: data?.homeEditorialImageMediaId ?? null,
    polarisFeedUrl: data?.polarisFeedUrl ?? null,
    idleTimeoutMs: data?.idleTimeoutMs ?? null,
    spamLinkThreshold: data?.spamLinkThreshold ?? null,
    spamKeywords: data?.spamKeywords ?? [],
    spamDomainBlocklist: data?.spamDomainBlocklist ?? [],
    auditLogRetentionDays: data?.auditLogRetentionDays ?? 365,
    constellationDemoEnabled: data?.constellationDemoEnabled ?? true,
    ...overrides,
  });

  const handlePickMedia = (m: MediaItem) => {
    if (pickerOpen === "homeb-hero") {
      updateMutation.mutate(buildPayload({ homeBHeroImageMediaId: m.id }));
    } else if (pickerOpen === "homeb-video") {
      updateMutation.mutate(buildPayload({ homeBHeroVideoMediaId: m.id }));
    }
    setPickerOpen(null);
  };

  const currentHomeBHeroBgType: HeroBackgroundType | null =
    data?.homeBHeroBackgroundType === "video"
      ? "video"
      : data?.homeBHeroBackgroundType === "image"
        ? "image"
        : null;

  const currentHeroBgType: HeroBackgroundType =
    (data?.homeHeroBackgroundType as HeroBackgroundType | null | undefined) === "video"
      ? "video"
      : "image";

  const currentHomeRootVariant: HomeRootVariant =
    (data?.homeRootVariant as HomeRootVariant | null | undefined) === "b" ? "b" : "a";

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
        ): which variant serves the root URL, hero media overrides, and editable copy.
        The original home page media is configured in{" "}
        <Link href="/site-config/site-settings" className="underline">
          Site Settings
        </Link>
        .
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 max-w-3xl">

          {/* 1 ── Root variant selector */}
          <div className="rounded-md border border-border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-1">Homepage variant at /</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Choose which homepage design is served at the root URL. The non-active
                variant remains accessible at its alternate path (<code>/home-a</code> or{" "}
                <code>/home-b</code>) for comparison without a code change.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              {(["a", "b"] as const).map((variant) => {
                const active = currentHomeRootVariant === variant;
                const label = variant === "a" ? "Original Home (A)" : "Alt Home (B)";
                const description =
                  variant === "a"
                    ? "The original home page design. Lives at /home-a as well."
                    : "The Alt Home design. Lives at /home-b as well.";
                return (
                  <button
                    key={variant}
                    type="button"
                    disabled={updateMutation.isPending}
                    data-testid={`home-root-variant-${variant}`}
                    onClick={() =>
                      updateMutation.mutate(buildPayload({ homeRootVariant: variant }))
                    }
                    className={`flex-1 text-left rounded-lg border-2 p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{label}</span>
                      {active && (
                        <span
                          data-testid={`home-root-variant-${variant}-active`}
                          className="text-xs font-medium text-primary px-2 py-0.5 rounded-full bg-primary/10"
                        >
                          Active at /
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </button>
                );
              })}
            </div>
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
        selectedId={
          pickerOpen === "homeb-hero"
            ? data?.homeBHeroImageMediaId ?? null
            : pickerOpen === "homeb-video"
              ? data?.homeBHeroVideoMediaId ?? null
              : null
        }
        categorySlug={pickerOpen === "homeb-hero" ? "north-star" : undefined}
        kind={pickerOpen === "homeb-video" ? "video" : "image"}
      />
    </AdminLayout>
  );
}

