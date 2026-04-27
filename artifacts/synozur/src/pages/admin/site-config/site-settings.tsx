import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Image as ImageIcon, Video as VideoIcon, X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { api, type AdminSiteSettings, type UpdateSiteSettingsBody } from "@/lib/api";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import type { MediaItem } from "@workspace/api-client-react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO = `${BASE_PATH}/images/hero-bg.png`;
const DEFAULT_EDITORIAL = `${BASE_PATH}/images/home-hero-editorial.png`;

export default function AdminSiteSettings() {
  const qc = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<null | "hero" | "editorial" | "video">(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
  });

  const [requireConsent, setRequireConsent] = useState<boolean | null>(null);
  const [polarisFeedDraft, setPolarisFeedDraft] = useState<string | null>(null);

  // #54: spam rule editor local state
  const [spamLinkThresholdDraft, setSpamLinkThresholdDraft] = useState<string | null>(null);
  const [spamKeywordsDraft, setSpamKeywordsDraft] = useState<string[] | null>(null);
  const [spamKeywordInput, setSpamKeywordInput] = useState("");
  const [spamDomainDraft, setSpamDomainDraft] = useState<string[] | null>(null);
  const [spamDomainInput, setSpamDomainInput] = useState("");
  type SiteTheme = "cosmic" | "aurora";
  type HeroBackgroundType = "image" | "video";

  useEffect(() => {
    if (data && requireConsent === null) {
      setRequireConsent(data.requireCookieConsent);
    }
  }, [data, requireConsent]);

  useEffect(() => {
    if (data && polarisFeedDraft === null) {
      setPolarisFeedDraft(data.polarisFeedUrl ?? "");
    }
  }, [data, polarisFeedDraft]);

  useEffect(() => {
    if (data && spamLinkThresholdDraft === null) {
      setSpamLinkThresholdDraft(
        typeof data.spamLinkThreshold === "number" ? String(data.spamLinkThreshold) : "",
      );
    }
  }, [data, spamLinkThresholdDraft]);

  useEffect(() => {
    if (data && spamKeywordsDraft === null) {
      setSpamKeywordsDraft(data.spamKeywords ?? []);
    }
  }, [data, spamKeywordsDraft]);

  useEffect(() => {
    if (data && spamDomainDraft === null) {
      setSpamDomainDraft(data.spamDomainBlocklist ?? []);
    }
  }, [data, spamDomainDraft]);

  const updateMutation = useMutation({
    mutationFn: (next: UpdateSiteSettingsBody) => api.updateAdminSiteSettings(next),
    onSuccess: (result) => {
      qc.setQueryData(["admin-site-settings"], result);
      qc.invalidateQueries({ queryKey: ["public-site-settings"] });
      setRequireConsent(result.requireCookieConsent);
      setPolarisFeedDraft(result.polarisFeedUrl ?? "");
      setSpamLinkThresholdDraft(
        typeof result.spamLinkThreshold === "number" ? String(result.spamLinkThreshold) : "",
      );
      setSpamKeywordsDraft(result.spamKeywords ?? []);
      setSpamDomainDraft(result.spamDomainBlocklist ?? []);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    },
  });

  // Idle timeout (#125): admin override for the session idle window. null
  // means "use the IDLE_TIMEOUT_MS env var / 4 hour default".
  const IDLE_TIMEOUT_OPTIONS: { hours: number; label: string }[] = [
    { hours: 1, label: "1 hour" },
    { hours: 2, label: "2 hours" },
    { hours: 4, label: "4 hours (default)" },
    { hours: 8, label: "8 hours" },
    { hours: 12, label: "12 hours" },
    { hours: 24, label: "24 hours" },
  ];
  const idleTimeoutValue: string =
    typeof data?.idleTimeoutMs === "number" && data.idleTimeoutMs > 0
      ? String(data.idleTimeoutMs)
      : "default";

  const current = requireConsent ?? data?.requireCookieConsent ?? false;

  const currentTheme: SiteTheme =
    (data?.siteTheme as SiteTheme | null | undefined) === "aurora" ? "aurora" : "cosmic";

  const currentHeroBgType: HeroBackgroundType =
    (data?.homeHeroBackgroundType as HeroBackgroundType | null | undefined) === "video" ? "video" : "image";

  const buildPayload = (overrides: Partial<UpdateSiteSettingsBody>): UpdateSiteSettingsBody => ({
    requireCookieConsent: current,
    homeHeroBackgroundType: currentHeroBgType,
    siteTheme: currentTheme,
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
    ...overrides,
  });

  // New writes target the `*MediaId` UUID columns and clear the legacy
  // integer `*AssetId` columns so the server's URL resolver consults the
  // unified media table on read; legacy rows that haven't been re-picked
  // continue to render via the asset fallback in `resolveImageUrls`.
  const handlePickMedia = (m: MediaItem) => {
    if (pickerOpen === "hero") {
      updateMutation.mutate(
        buildPayload({ homeHeroImageAssetId: null, homeHeroImageMediaId: m.id }),
      );
    } else if (pickerOpen === "editorial") {
      updateMutation.mutate(
        buildPayload({
          homeEditorialImageAssetId: null,
          homeEditorialImageMediaId: m.id,
        }),
      );
    } else if (pickerOpen === "video") {
      updateMutation.mutate(
        buildPayload({ homeHeroVideoAssetId: null, homeHeroVideoMediaId: m.id }),
      );
    }
    setPickerOpen(null);
  };

  const handleReset = (which: "hero" | "editorial" | "video") => {
    if (which === "hero") {
      updateMutation.mutate(
        buildPayload({ homeHeroImageAssetId: null, homeHeroImageMediaId: null }),
      );
    } else if (which === "editorial") {
      updateMutation.mutate(
        buildPayload({
          homeEditorialImageAssetId: null,
          homeEditorialImageMediaId: null,
        }),
      );
    } else {
      updateMutation.mutate(
        buildPayload({ homeHeroVideoAssetId: null, homeHeroVideoMediaId: null }),
      );
    }
  };

  return (
    <AdminLayout
      title="Site Settings"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Site Config" },
        { label: "Site Settings" },
      ]}
    >
      <p className="text-sm text-muted-foreground mb-8 max-w-3xl">
        Configure public site behavior. Changes take effect immediately.
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          <div className="rounded-md border border-border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-1">Site theme</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Choose the colour palette applied across the public site and admin shell.
                The change takes effect immediately for all visitors.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              {(["cosmic", "aurora"] as const).map((slug) => {
                const active = currentTheme === slug;
                const label = slug === "cosmic" ? "Cosmic (default)" : "Aurora";
                const description =
                  slug === "cosmic"
                    ? "Deep indigo night sky · Violet #810FFB primary"
                    : "Deep purple · Violet primary · Magenta secondary (matches SCDP)";
                const swatches =
                  slug === "cosmic"
                    ? ["#810FFB", "#5E2DA0", "#CC1E8A", "#2563EB"]
                    : ["#7C3AED", "#D4178A", "#9F56F0", "#E05FA0"];
                return (
                  <button
                    key={slug}
                    type="button"
                    disabled={updateMutation.isPending}
                    data-testid={`theme-option-${slug}`}
                    onClick={() =>
                      updateMutation.mutate(buildPayload({ siteTheme: slug }))
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
                        <span className="text-xs font-medium text-primary px-2 py-0.5 rounded-full bg-primary/10">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{description}</p>
                    <div className="flex gap-1.5">
                      {swatches.map((color) => (
                        <span
                          key={color}
                          className="h-5 w-5 rounded-full border border-black/10"
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-border p-6 space-y-4">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Require cookie consent</h2>
                <p className="text-sm text-muted-foreground max-w-xl">
                  When ON, visitors see a cookie consent banner and marketing tags
                  (GA4, LinkedIn Insight, Meta Pixel) only load after they click Accept.
                  When OFF, the banner is hidden and marketing tags load for everyone.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={current}
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate(buildPayload({ requireCookieConsent: !current }))}
                data-testid="toggle-require-cookie-consent"
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                  current ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-background shadow ring-0 transition ${
                    current ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <HomePageSection
            title="Home page"
            description="Pick the imagery and video used at the top of the public home page. Each picker is filtered to a curated category from the asset library. Reset to use the original built-in defaults."
            heroUrl={data?.homeHeroImageUrl ?? null}
            heroFallback={DEFAULT_HERO}
            editorialUrl={data?.homeEditorialImageUrl ?? null}
            editorialFallback={DEFAULT_EDITORIAL}
            heroVideoUrl={data?.homeHeroVideoUrl ?? null}
            onOpenHero={() => setPickerOpen("hero")}
            onOpenEditorial={() => setPickerOpen("editorial")}
            onOpenVideo={() => setPickerOpen("video")}
            onResetHero={() => handleReset("hero")}
            onResetEditorial={() => handleReset("editorial")}
            onResetVideo={() => handleReset("video")}
            disabled={updateMutation.isPending}
            heroBgType={currentHeroBgType}
            onHeroBgTypeChange={(type) =>
              updateMutation.mutate(buildPayload({ homeHeroBackgroundType: type }))
            }
          />

          <div className="rounded-md border border-border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-1">Polaris podcast</h2>
              <p className="text-sm text-muted-foreground">
                Libsyn RSS feed URL used by the{" "}
                <Link href="/library/polaris-episodes">
                  <a className="underline">Polaris episodes</a>
                </Link>{" "}
                admin's “Import from Libsyn” flow.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="url"
                placeholder="https://feeds.libsyn.com/550947/rss"
                value={polarisFeedDraft ?? ""}
                onChange={(e) => setPolarisFeedDraft(e.target.value)}
                disabled={updateMutation.isPending}
                data-testid="input-polaris-feed-url"
              />
              <Button
                variant="outline"
                onClick={() =>
                  updateMutation.mutate(
                    buildPayload({
                      polarisFeedUrl: polarisFeedDraft?.trim()
                        ? polarisFeedDraft.trim()
                        : null,
                    }),
                  )
                }
                disabled={
                  updateMutation.isPending ||
                  (polarisFeedDraft ?? "").trim() === (data?.polarisFeedUrl ?? "").trim()
                }
                data-testid="button-save-polaris-feed-url"
              >
                Save
              </Button>
              {data?.polarisFeedUrl && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPolarisFeedDraft("");
                    updateMutation.mutate(buildPayload({ polarisFeedUrl: null }));
                  }}
                  disabled={updateMutation.isPending}
                  data-testid="button-clear-polaris-feed-url"
                >
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-1">Session idle timeout</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                How long an admin or member can be inactive before they're
                signed out. Choose <em>Server default</em> to use the value
                set by the <code>IDLE_TIMEOUT_MS</code> environment variable
                (or the built-in 4 hour fallback). Changes apply to all new
                session checks within a few seconds — already signed-in users
                keep their session until their next request.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={updateMutation.isPending}
                value={idleTimeoutValue}
                data-testid="select-idle-timeout"
                onChange={(e) => {
                  const raw = e.target.value;
                  const next = raw === "default" ? null : parseInt(raw, 10);
                  updateMutation.mutate(buildPayload({ idleTimeoutMs: next }));
                }}
              >
                <option value="default">Server default</option>
                {IDLE_TIMEOUT_OPTIONS.map(({ hours, label }) => (
                  <option key={hours} value={hours * 60 * 60 * 1000}>
                    {label}
                  </option>
                ))}
              </select>
              {idleTimeoutValue !== "default" && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    updateMutation.mutate(buildPayload({ idleTimeoutMs: null }))
                  }
                  disabled={updateMutation.isPending}
                  data-testid="button-reset-idle-timeout"
                >
                  <X className="h-4 w-4 mr-1" /> Use server default
                </Button>
              )}
            </div>
          </div>

          {/* #54: Spam filter rules */}
          <div className="rounded-md border border-border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Spam filter rules</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Server-side rules applied to every comment submission after CAPTCHA
                verification. Comments that exceed the threshold are flagged as spam
                and held for review — they are never silently dropped.
              </p>
            </div>

            {/* Link threshold */}
            <div className="space-y-2">
              <label htmlFor="spam-link-threshold" className="text-sm font-medium">
                Link count threshold
              </label>
              <p className="text-xs text-muted-foreground">
                Comments containing more than this many URLs are flagged as spam.
                Set to 0 to disable this rule.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id="spam-link-threshold"
                  type="number"
                  min={0}
                  step={1}
                  className="w-28"
                  placeholder="3"
                  value={spamLinkThresholdDraft ?? ""}
                  onChange={(e) => setSpamLinkThresholdDraft(e.target.value)}
                  disabled={updateMutation.isPending}
                  data-testid="input-spam-link-threshold"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const parsed = parseInt(spamLinkThresholdDraft ?? "", 10);
                    updateMutation.mutate(
                      buildPayload({
                        spamLinkThreshold: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
                      }),
                    );
                  }}
                  disabled={
                    updateMutation.isPending ||
                    spamLinkThresholdDraft === (
                      typeof data?.spamLinkThreshold === "number"
                        ? String(data.spamLinkThreshold)
                        : ""
                    )
                  }
                  data-testid="button-save-spam-link-threshold"
                >
                  Save
                </Button>
              </div>
            </div>

            {/* Blocked keywords */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Blocked keywords</div>
              <p className="text-xs text-muted-foreground">
                Comments containing any of these words (case-insensitive) are flagged as spam.
              </p>
              <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                {(spamKeywordsDraft ?? []).map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                  >
                    {kw}
                    <button
                      type="button"
                      aria-label={`Remove keyword ${kw}`}
                      className="hover:text-destructive"
                      disabled={updateMutation.isPending}
                      onClick={() => {
                        const next = (spamKeywordsDraft ?? []).filter((k) => k !== kw);
                        setSpamKeywordsDraft(next);
                        updateMutation.mutate(buildPayload({ spamKeywords: next }));
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add keyword…"
                  value={spamKeywordInput}
                  onChange={(e) => setSpamKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const kw = spamKeywordInput.trim().toLowerCase();
                      if (!kw || (spamKeywordsDraft ?? []).includes(kw)) return;
                      const next = [...(spamKeywordsDraft ?? []), kw];
                      setSpamKeywordsDraft(next);
                      setSpamKeywordInput("");
                      updateMutation.mutate(buildPayload({ spamKeywords: next }));
                    }
                  }}
                  disabled={updateMutation.isPending}
                  data-testid="input-spam-keyword"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const kw = spamKeywordInput.trim().toLowerCase();
                    if (!kw || (spamKeywordsDraft ?? []).includes(kw)) return;
                    const next = [...(spamKeywordsDraft ?? []), kw];
                    setSpamKeywordsDraft(next);
                    setSpamKeywordInput("");
                    updateMutation.mutate(buildPayload({ spamKeywords: next }));
                  }}
                  disabled={updateMutation.isPending || !spamKeywordInput.trim()}
                  data-testid="button-add-spam-keyword"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>

            {/* Blocked domains */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Blocked domains</div>
              <p className="text-xs text-muted-foreground">
                Comments linking to any of these domains are flagged as spam.
                Enter bare domains, e.g. <code>spam-site.com</code>.
              </p>
              <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                {(spamDomainDraft ?? []).map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                  >
                    {d}
                    <button
                      type="button"
                      aria-label={`Remove domain ${d}`}
                      className="hover:text-destructive"
                      disabled={updateMutation.isPending}
                      onClick={() => {
                        const next = (spamDomainDraft ?? []).filter((x) => x !== d);
                        setSpamDomainDraft(next);
                        updateMutation.mutate(buildPayload({ spamDomainBlocklist: next }));
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add domain…"
                  value={spamDomainInput}
                  onChange={(e) => setSpamDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const d = spamDomainInput.trim().toLowerCase();
                      if (!d || (spamDomainDraft ?? []).includes(d)) return;
                      const next = [...(spamDomainDraft ?? []), d];
                      setSpamDomainDraft(next);
                      setSpamDomainInput("");
                      updateMutation.mutate(buildPayload({ spamDomainBlocklist: next }));
                    }
                  }}
                  disabled={updateMutation.isPending}
                  data-testid="input-spam-domain"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const d = spamDomainInput.trim().toLowerCase();
                    if (!d || (spamDomainDraft ?? []).includes(d)) return;
                    const next = [...(spamDomainDraft ?? []), d];
                    setSpamDomainDraft(next);
                    setSpamDomainInput("");
                    updateMutation.mutate(buildPayload({ spamDomainBlocklist: next }));
                  }}
                  disabled={updateMutation.isPending || !spamDomainInput.trim()}
                  data-testid="button-add-spam-domain"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>

          <div className="h-5 text-sm text-muted-foreground flex items-center gap-2">
            {showSaved && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" data-testid="text-saved-indicator">
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
          pickerOpen === "hero"
            ? data?.homeHeroImageMediaId ?? null
            : pickerOpen === "editorial"
              ? data?.homeEditorialImageMediaId ?? null
              : pickerOpen === "video"
                ? data?.homeHeroVideoMediaId ?? null
                : null
        }
        categorySlug={
          pickerOpen === "hero"
            ? "north-star"
            : pickerOpen === "editorial"
              ? "people"
              : undefined
        }
      />
    </AdminLayout>
  );
}

interface HomeSectionProps {
  title: string;
  description: string;
  heroUrl: string | null;
  heroFallback: string;
  editorialUrl: string | null;
  editorialFallback: string;
  heroVideoUrl: string | null;
  onOpenHero: () => void;
  onOpenEditorial: () => void;
  onOpenVideo: () => void;
  onResetHero: () => void;
  onResetEditorial: () => void;
  onResetVideo: () => void;
  disabled: boolean;
  heroBgType: "image" | "video";
  onHeroBgTypeChange: (type: "image" | "video") => void;
}

function HomePageSection(props: HomeSectionProps) {
  return (
    <div className="rounded-md border border-border p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">{props.title}</h2>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Hero background type</div>
        <p className="text-xs text-muted-foreground">
          Choose whether the hero section displays a static image or a background video (autoplay, muted, looped).
        </p>
        <div className="flex gap-3">
          {(["image", "video"] as const).map((type) => {
            const active = props.heroBgType === type;
            return (
              <button
                key={type}
                type="button"
                disabled={props.disabled}
                data-testid={`hero-bg-type-${type}`}
                onClick={() => props.onHeroBgTypeChange(type)}
                className={`flex-1 text-left rounded-lg border-2 px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 capitalize ${
                  active
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{type === "image" ? "Image (default)" : "Video"}</span>
                  {active && (
                    <span className="text-xs font-medium text-primary px-2 py-0.5 rounded-full bg-primary/10">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {type === "image"
                    ? "Displays the static hero background image."
                    : "Plays the background video silently on loop; image is used as poster/fallback."}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <ImagePicker
        label="Hero background image"
        helper="Cosmic / starry background that sits behind the home page hero. Filter: north-star."
        previewUrl={props.heroUrl ?? props.heroFallback}
        isOverridden={props.heroUrl != null}
        testIdPrefix="home-hero"
        onPick={props.onOpenHero}
        onReset={props.onResetHero}
        disabled={props.disabled}
      />

      <VideoPicker
        label="Hero background video"
        helper="Custom video played silently on loop in the hero section when the type is set to Video. When cleared, the bundled default video is used."
        isOverridden={props.heroVideoUrl != null}
        originalName={props.heroVideoUrl ? "Custom video" : null}
        testIdPrefix="home-hero-video"
        onPick={props.onOpenVideo}
        onReset={props.onResetVideo}
        disabled={props.disabled}
      />

      <ImagePicker
        label="Editorial image (Find Your North Star)"
        helper="Square editorial image shown beside the Find Your North Star copy. Filter: people."
        previewUrl={props.editorialUrl ?? props.editorialFallback}
        isOverridden={props.editorialUrl != null}
        testIdPrefix="home-editorial"
        onPick={props.onOpenEditorial}
        onReset={props.onResetEditorial}
        disabled={props.disabled}
      />
    </div>
  );
}

interface ImagePickerProps {
  label: string;
  helper: string;
  previewUrl: string;
  isOverridden: boolean;
  testIdPrefix: string;
  onPick: () => void;
  onReset: () => void;
  disabled: boolean;
}

function ImagePicker({ label, helper, previewUrl, isOverridden, testIdPrefix, onPick, onReset, disabled }: ImagePickerProps) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{helper}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-40 h-24 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${label} preview`}
              className="h-full w-full object-cover"
              data-testid={`${testIdPrefix}-preview`}
            />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPick}
            disabled={disabled}
            data-testid={`${testIdPrefix}-pick`}
          >
            {isOverridden ? "Change image" : "Pick from library"}
          </Button>
          {isOverridden && (
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              disabled={disabled}
              data-testid={`${testIdPrefix}-reset`}
            >
              <X className="h-4 w-4 mr-1" /> Reset to default
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface VideoPickerProps {
  label: string;
  helper: string;
  isOverridden: boolean;
  originalName: string | null;
  testIdPrefix: string;
  onPick: () => void;
  onReset: () => void;
  disabled: boolean;
}

function VideoPicker({ label, helper, isOverridden, originalName, testIdPrefix, onPick, onReset, disabled }: VideoPickerProps) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{helper}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-40 h-24 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
          {isOverridden ? (
            <div className="flex flex-col items-center gap-1 p-2 text-center">
              <VideoIcon className="h-8 w-8 text-primary" />
              {originalName && (
                <span className="text-[10px] text-muted-foreground truncate w-full px-1" title={originalName}>
                  {originalName}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 p-2 text-center">
              <VideoIcon className="h-8 w-8 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Bundled default</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPick}
            disabled={disabled}
            data-testid={`${testIdPrefix}-pick`}
          >
            {isOverridden ? "Change video" : "Upload / pick video"}
          </Button>
          {isOverridden && (
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              disabled={disabled}
              data-testid={`${testIdPrefix}-reset`}
            >
              <X className="h-4 w-4 mr-1" /> Reset to default
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
