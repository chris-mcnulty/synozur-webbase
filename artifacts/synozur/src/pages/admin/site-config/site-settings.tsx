import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { api, type AdminSiteSettings, type UpdateSiteSettingsBody } from "@/lib/api";
import { AssetLibraryModal } from "@/components/admin/AssetLibraryModal";
import type { Asset } from "@workspace/api-zod/types";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO = `${BASE_PATH}/images/hero-bg.png`;
const DEFAULT_EDITORIAL = `${BASE_PATH}/images/home-hero-editorial.png`;

export default function AdminSiteSettings() {
  const qc = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<null | "hero" | "editorial">(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
  });

  const [requireConsent, setRequireConsent] = useState<boolean | null>(null);
  const [polarisFeedDraft, setPolarisFeedDraft] = useState<string | null>(null);

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

  const updateMutation = useMutation({
    mutationFn: (next: UpdateSiteSettingsBody) => api.updateAdminSiteSettings(next),
    onSuccess: (result) => {
      qc.setQueryData(["admin-site-settings"], result);
      qc.invalidateQueries({ queryKey: ["public-site-settings"] });
      setRequireConsent(result.requireCookieConsent);
      setPolarisFeedDraft(result.polarisFeedUrl ?? "");
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    },
  });

  const current = requireConsent ?? data?.requireCookieConsent ?? false;

  const buildPayload = (overrides: Partial<UpdateSiteSettingsBody>): UpdateSiteSettingsBody => ({
    requireCookieConsent: current,
    homeHeroImageAssetId: data?.homeHeroImageAssetId ?? null,
    homeEditorialImageAssetId: data?.homeEditorialImageAssetId ?? null,
    polarisFeedUrl: data?.polarisFeedUrl ?? null,
    ...overrides,
  });

  const handlePickAsset = (asset: Asset) => {
    if (pickerOpen === "hero") {
      updateMutation.mutate(buildPayload({ homeHeroImageAssetId: asset.id }));
    } else if (pickerOpen === "editorial") {
      updateMutation.mutate(buildPayload({ homeEditorialImageAssetId: asset.id }));
    }
    setPickerOpen(null);
  };

  const handleReset = (which: "hero" | "editorial") => {
    if (which === "hero") {
      updateMutation.mutate(buildPayload({ homeHeroImageAssetId: null }));
    } else {
      updateMutation.mutate(buildPayload({ homeEditorialImageAssetId: null }));
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
            description="Pick the imagery used at the top of the public home page. Each picker is filtered to a curated category from the asset library. Reset to use the original built-in image."
            heroUrl={data?.homeHeroImageUrl ?? null}
            heroFallback={DEFAULT_HERO}
            editorialUrl={data?.homeEditorialImageUrl ?? null}
            editorialFallback={DEFAULT_EDITORIAL}
            onOpenHero={() => setPickerOpen("hero")}
            onOpenEditorial={() => setPickerOpen("editorial")}
            onResetHero={() => handleReset("hero")}
            onResetEditorial={() => handleReset("editorial")}
            disabled={updateMutation.isPending}
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

      <AssetLibraryModal
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        onSelect={handlePickAsset}
        selectedId={
          pickerOpen === "hero"
            ? data?.homeHeroImageAssetId ?? null
            : pickerOpen === "editorial"
              ? data?.homeEditorialImageAssetId ?? null
              : null
        }
        category={pickerOpen === "hero" ? "north-star" : pickerOpen === "editorial" ? "people" : undefined}
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
  onOpenHero: () => void;
  onOpenEditorial: () => void;
  onResetHero: () => void;
  onResetEditorial: () => void;
  disabled: boolean;
}

function HomePageSection(props: HomeSectionProps) {
  return (
    <div className="rounded-md border border-border p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">{props.title}</h2>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>

      <ImagePicker
        label="Hero background"
        helper="Cosmic / starry background that sits behind the home page hero. Filter: north-star."
        previewUrl={props.heroUrl ?? props.heroFallback}
        isOverridden={props.heroUrl != null}
        testIdPrefix="home-hero"
        onPick={props.onOpenHero}
        onReset={props.onResetHero}
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
