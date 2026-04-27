import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Image as ImageIcon,
  X,
  Plus,
  ExternalLink,
  Search,
  Share2,
  Tag,
  ShieldCheck,
  Map,
  Building2,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { MediaPickerModal } from "@/components/admin/MediaPickerModal";
import { api, type AdminSiteSettings, type UpdateSiteSettingsBody } from "@/lib/api";
import type { MediaItem } from "@workspace/api-client-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4 pl-8">{children}</div>
    </div>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: React.ReactNode;
  children: React.ReactNode;
}) {
  const generatedId = React.useId();
  const helperId = `${generatedId}-helper`;

  const childElement = React.isValidElement(children) ? children : null;
  const existingId = childElement?.props?.id as string | undefined;
  const controlId = existingId ?? `${generatedId}-control`;
  const existingDescribedBy = childElement?.props?.["aria-describedby"] as string | undefined;
  const describedBy = helper
    ? [existingDescribedBy, helperId].filter(Boolean).join(" ")
    : existingDescribedBy;

  const content = childElement
    ? React.cloneElement(childElement, {
        id: controlId,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })
    : children;

  return (
    <div className="space-y-1.5">
      <label htmlFor={controlId} className="text-sm font-medium">
        {label}
      </label>
      {helper && (
        <p id={helperId} className="text-xs text-muted-foreground">
          {helper}
        </p>
      )}
      {content}
    </div>
  );
}

function EnvFallback({ varName }: { varName: string }) {
  return (
    <span className="text-xs text-muted-foreground italic">
      Fallback: <code className="bg-muted px-1 py-0.5 rounded text-xs">{varName}</code>
    </span>
  );
}

interface ImagePickerInlineProps {
  label: string;
  helper: string;
  previewUrl: string | null;
  isOverridden: boolean;
  testIdPrefix: string;
  onPick: () => void;
  onReset: () => void;
  disabled: boolean;
}

function ImagePickerInline({
  label,
  helper,
  previewUrl,
  isOverridden,
  testIdPrefix,
  onPick,
  onReset,
  disabled,
}: ImagePickerInlineProps) {
  return (
    <Field label={label} helper={helper}>
      <div className="flex items-center gap-4">
        <div className="w-32 h-20 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={label}
              className="h-full w-full object-cover"
              data-testid={`${testIdPrefix}-preview`}
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
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
              size="sm"
              onClick={onReset}
              disabled={disabled}
              data-testid={`${testIdPrefix}-reset`}
            >
              <X className="h-3 w-3 mr-1" /> Reset
            </Button>
          )}
        </div>
      </div>
    </Field>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

type PickerSlot = "og-image" | "org-logo";

export default function MarketingSeo() {
  const qc = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<PickerSlot | null>(null);

  // ── load ──────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api.getAdminSiteSettings(),
  });

  // ── local draft state ──────────────────────────────────────────────────────
  const [titleTemplate, setTitleTemplate] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [twitterHandle, setTwitterHandle] = useState<string>("");
  const [twitterCard, setTwitterCard] = useState<string>("summary_large_image");
  const [linkedinCompanyUrl, setLinkedinCompanyUrl] = useState<string>("");
  const [ga4Id, setGa4Id] = useState<string>("");
  const [liPartnerId, setLiPartnerId] = useState<string>("");
  const [metaPixelId, setMetaPixelId] = useState<string>("");
  const [googleVerification, setGoogleVerification] = useState<string>("");
  const [bingVerification, setBingVerification] = useState<string>("");
  const [excludedPaths, setExcludedPaths] = useState<string>("");
  const [sectionFlags, setSectionFlags] = useState<Record<string, boolean>>({});
  const [orgName, setOrgName] = useState<string>("");
  const [orgLegalName, setOrgLegalName] = useState<string>("");
  const [orgStreet, setOrgStreet] = useState<string>("");
  const [orgLocality, setOrgLocality] = useState<string>("");
  const [orgRegion, setOrgRegion] = useState<string>("");
  const [orgPostal, setOrgPostal] = useState<string>("");
  const [orgCountry, setOrgCountry] = useState<string>("");
  const [orgSameAs, setOrgSameAs] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setTitleTemplate(data.seoDefaultTitleTemplate ?? "");
      setDescription(data.seoDefaultDescription ?? "");
      setTwitterHandle(data.seoTwitterHandle ?? "");
      setTwitterCard(data.seoTwitterCardType ?? "summary_large_image");
      setLinkedinCompanyUrl(data.seoLinkedinCompanyUrl ?? "");
      setGa4Id(data.tagGa4Id ?? "");
      setLiPartnerId(data.tagLinkedinPartnerId ?? "");
      setMetaPixelId(data.tagMetaPixelId ?? "");
      setGoogleVerification(data.seoGoogleSiteVerification ?? "");
      setBingVerification(data.seoBingSiteVerification ?? "");
      setExcludedPaths((data.sitemapExcludedPaths ?? []).join("\n"));
      setSectionFlags(data.sitemapSectionFlags ?? {});
      setOrgName(data.orgName ?? "");
      setOrgLegalName(data.orgLegalName ?? "");
      setOrgStreet(data.orgStreetAddress ?? "");
      setOrgLocality(data.orgAddressLocality ?? "");
      setOrgRegion(data.orgAddressRegion ?? "");
      setOrgPostal(data.orgPostalCode ?? "");
      setOrgCountry(data.orgAddressCountry ?? "");
      setOrgSameAs(data.orgSameAs ?? []);
      setInitialized(true);
    }
  }, [data, initialized]);

  // ── mutation ───────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (next: UpdateSiteSettingsBody) => api.updateAdminSiteSettings(next),
    onSuccess: (result) => {
      qc.setQueryData(["admin-site-settings"], result);
      qc.invalidateQueries({ queryKey: ["public-site-settings"] });
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    },
  });

  if (!data && !isLoading) return null;

  // ── build payload helper ───────────────────────────────────────────────────
  const buildPayload = (overrides: Partial<UpdateSiteSettingsBody> = {}): UpdateSiteSettingsBody => {
    const paths = excludedPaths
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      requireCookieConsent: data.requireCookieConsent,
      homeHeroImageAssetId: data.homeHeroImageAssetId ?? null,
      homeHeroImageMediaId: data.homeHeroImageMediaId ?? null,
      homeEditorialImageAssetId: data.homeEditorialImageAssetId ?? null,
      homeEditorialImageMediaId: data.homeEditorialImageMediaId ?? null,
      polarisFeedUrl: data.polarisFeedUrl ?? null,
      seoDefaultTitleTemplate: titleTemplate.trim() || null,
      seoDefaultDescription: description.trim() || null,
      seoDefaultOgImageAssetId: data.seoDefaultOgImageAssetId ?? null,
      seoDefaultOgImageMediaId: data.seoDefaultOgImageMediaId ?? null,
      seoTwitterHandle: twitterHandle.trim() || null,
      seoTwitterCardType: twitterCard || null,
      seoLinkedinCompanyUrl: linkedinCompanyUrl.trim() || null,
      seoGoogleSiteVerification: googleVerification.trim() || null,
      seoBingSiteVerification: bingVerification.trim() || null,
      orgName: orgName.trim() || null,
      orgLegalName: orgLegalName.trim() || null,
      orgLogoAssetId: data.orgLogoAssetId ?? null,
      orgLogoMediaId: data.orgLogoMediaId ?? null,
      orgStreetAddress: orgStreet.trim() || null,
      orgAddressLocality: orgLocality.trim() || null,
      orgAddressRegion: orgRegion.trim() || null,
      orgPostalCode: orgPostal.trim() || null,
      orgAddressCountry: orgCountry.trim() || null,
      orgSameAs: orgSameAs.map((value) => value.trim()).filter(Boolean),
      tagGa4Id: ga4Id.trim() || null,
      tagLinkedinPartnerId: liPartnerId.trim() || null,
      tagMetaPixelId: metaPixelId.trim() || null,
      sitemapExcludedPaths: paths.length ? paths : null,
      sitemapSectionFlags: Object.keys(sectionFlags).length ? sectionFlags : null,
      ...overrides,
    };
  };

  const handleSave = () => updateMutation.mutate(buildPayload());

  // New writes target the `*MediaId` UUID columns; the legacy integer
  // `*AssetId` columns are cleared so the server's URL resolver consults
  // the unified media table on read.
  const handlePickMedia = (m: MediaItem) => {
    if (pickerOpen === "og-image") {
      updateMutation.mutate(
        buildPayload({
          seoDefaultOgImageAssetId: null,
          seoDefaultOgImageMediaId: m.id,
        }),
      );
    } else if (pickerOpen === "org-logo") {
      updateMutation.mutate(
        buildPayload({ orgLogoAssetId: null, orgLogoMediaId: m.id }),
      );
    }
    setPickerOpen(null);
  };

  const handleResetAsset = (slot: PickerSlot) => {
    if (slot === "og-image") {
      updateMutation.mutate(
        buildPayload({
          seoDefaultOgImageAssetId: null,
          seoDefaultOgImageMediaId: null,
        }),
      );
    } else {
      updateMutation.mutate(
        buildPayload({ orgLogoAssetId: null, orgLogoMediaId: null }),
      );
    }
  };

  const sectionKeys = ["insights", "services", "solutions", "library", "webinars", "events", "applications", "caseStudies", "models", "workshops"];

  const disabled = updateMutation.isPending || isLoading;

  return (
    <AdminLayout
      title="SEO"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "SEO" }]}
    >
      <p className="text-sm text-muted-foreground mb-8 max-w-3xl">
        Configure site-wide SEO defaults, social metadata, analytics tags, and structured data.
        Changes take effect on the next page load.
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 max-w-3xl">

          {/* ── 1. Defaults ─────────────────────────────────────────────── */}
          <SectionCard
            icon={Search}
            title="Defaults"
            description="Site-wide title template and fallback meta description used when individual pages don't supply their own."
          >
            <Field
              label="Title template"
              helper="Use {page} as the placeholder for the page name. Max 120 characters."
            >
              <Input
                placeholder="{page} | The Synozur Alliance"
                value={titleTemplate}
                maxLength={120}
                onChange={(e) => setTitleTemplate(e.target.value)}
                disabled={disabled}
                data-testid="input-seo-title-template"
              />
              <p className="text-xs text-muted-foreground text-right">
                {titleTemplate.length}/120
              </p>
            </Field>
            <Field
              label="Default meta description"
              helper="Fallback description used on pages that don't set one. Max 160 characters."
            >
              <Textarea
                placeholder="Strategy, AI, and Microsoft 365 advisory from The Synozur Alliance."
                value={description}
                maxLength={160}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
                disabled={disabled}
                data-testid="input-seo-description"
              />
              <p className="text-xs text-muted-foreground text-right">
                {description.length}/160
              </p>
            </Field>
            <ImagePickerInline
              label="Default OG image"
              helper="Fallback Open Graph / Twitter card image for pages that don't set one."
              previewUrl={data.seoDefaultOgImageUrl ?? null}
              isOverridden={
                data.seoDefaultOgImageMediaId != null ||
                data.seoDefaultOgImageAssetId != null
              }
              testIdPrefix="seo-og-image"
              onPick={() => setPickerOpen("og-image")}
              onReset={() => handleResetAsset("og-image")}
              disabled={disabled}
            />
          </SectionCard>

          {/* ── 2. Social ────────────────────────────────────────────────── */}
          <SectionCard
            icon={Share2}
            title="Social"
            description="Twitter/X handle and card defaults, LinkedIn company page — used in meta tags automatically."
          >
            <Field label="Twitter / X handle" helper="Include the @-sign, e.g. @synozur">
              <Input
                placeholder="@synozur"
                value={twitterHandle}
                onChange={(e) => setTwitterHandle(e.target.value)}
                disabled={disabled}
                data-testid="input-twitter-handle"
              />
            </Field>
            <Field label="Twitter card type">
              <Select
                value={twitterCard}
                onValueChange={(v) => setTwitterCard(v)}
                disabled={disabled}
              >
                <SelectTrigger data-testid="select-twitter-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary_large_image">Summary (large image)</SelectItem>
                  <SelectItem value="summary">Summary (small image)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="LinkedIn company URL" helper="Full URL to the company LinkedIn page.">
              <Input
                type="url"
                placeholder="https://www.linkedin.com/company/synozur"
                value={linkedinCompanyUrl}
                onChange={(e) => setLinkedinCompanyUrl(e.target.value)}
                disabled={disabled}
                data-testid="input-linkedin-url"
              />
            </Field>
          </SectionCard>

          {/* ── 3. Marketing tags ────────────────────────────────────────── */}
          <SectionCard
            icon={Tag}
            title="Marketing tags"
            description="Analytics and pixel IDs. DB values take priority over environment variables. The cookie-consent gate still applies."
          >
            <Field label="GA4 Measurement ID">
              <Input
                placeholder="G-XXXXXXXXXX"
                value={ga4Id}
                onChange={(e) => setGa4Id(e.target.value)}
                disabled={disabled}
                data-testid="input-ga4-id"
              />
              <EnvFallback varName="VITE_GA4_ID" />
            </Field>
            <Field label="LinkedIn Insight Partner ID">
              <Input
                placeholder="1234567"
                value={liPartnerId}
                onChange={(e) => setLiPartnerId(e.target.value)}
                disabled={disabled}
                data-testid="input-linkedin-partner-id"
              />
              <EnvFallback varName="VITE_LINKEDIN_PARTNER_ID" />
            </Field>
            <Field label="Meta Pixel ID">
              <Input
                placeholder="123456789012345"
                value={metaPixelId}
                onChange={(e) => setMetaPixelId(e.target.value)}
                disabled={disabled}
                data-testid="input-meta-pixel-id"
              />
              <EnvFallback varName="VITE_META_PIXEL_ID" />
            </Field>
          </SectionCard>

          {/* ── 4. Verification ──────────────────────────────────────────── */}
          <SectionCard
            icon={ShieldCheck}
            title="Search engine verification"
            description="Paste the token value only (not the full meta tag). Both tags are rendered site-wide."
          >
            <Field
              label="Google Search Console"
              helper={
                <>
                  Get your token from{" "}
                  <a
                    href="https://search.google.com/search-console"
                    target="_blank"
                    rel="noreferrer"
                    className="underline inline-flex items-center gap-0.5"
                  >
                    Google Search Console <ExternalLink className="h-3 w-3" />
                  </a>
                  . Use the "HTML meta tag" method.
                </>
              }
            >
              <Input
                placeholder="abc123def456…"
                value={googleVerification}
                onChange={(e) => setGoogleVerification(e.target.value)}
                disabled={disabled}
                data-testid="input-google-verification"
              />
            </Field>
            <Field
              label="Bing Webmaster Tools"
              helper={
                <>
                  Get your token from{" "}
                  <a
                    href="https://www.bing.com/webmasters"
                    target="_blank"
                    rel="noreferrer"
                    className="underline inline-flex items-center gap-0.5"
                  >
                    Bing Webmaster Tools <ExternalLink className="h-3 w-3" />
                  </a>
                  .
                </>
              }
            >
              <Input
                placeholder="abc123def456…"
                value={bingVerification}
                onChange={(e) => setBingVerification(e.target.value)}
                disabled={disabled}
                data-testid="input-bing-verification"
              />
            </Field>
          </SectionCard>

          {/* ── 5. Sitemap ───────────────────────────────────────────────── */}
          <SectionCard
            icon={Map}
            title="Sitemap"
            description="Control which site sections appear in /sitemap.xml and exclude specific paths."
          >
            <Field
              label="Section flags"
              helper="Uncheck a section to exclude all its URLs from the sitemap."
            >
              <div className="grid grid-cols-2 gap-2">
                {sectionKeys.map((key) => {
                  const isEnabled = sectionFlags[key] !== false;
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        disabled={disabled}
                        onChange={(e) =>
                          setSectionFlags((prev) => ({
                            ...prev,
                            [key]: e.target.checked,
                          }))
                        }
                        data-testid={`sitemap-flag-${key}`}
                        className="h-4 w-4 rounded border-border"
                      />
                      {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field
              label="Excluded paths"
              helper="One path per line (e.g. /admin/internal-page). Matching URLs are removed from the sitemap."
            >
              <Textarea
                placeholder="/admin/internal&#10;/preview"
                value={excludedPaths}
                rows={4}
                onChange={(e) => setExcludedPaths(e.target.value)}
                disabled={disabled}
                data-testid="textarea-sitemap-excluded"
              />
            </Field>
          </SectionCard>

          {/* ── 6. Organization ──────────────────────────────────────────── */}
          <SectionCard
            icon={Building2}
            title="Organization"
            description="Fields behind the Organization JSON-LD schema emitted on every public page. Falls back to built-in defaults when empty."
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="Display name">
                <Input
                  placeholder="The Synozur Alliance"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={disabled}
                  data-testid="input-org-name"
                />
              </Field>
              <Field label="Legal name">
                <Input
                  placeholder="The Synozur Alliance, LLC"
                  value={orgLegalName}
                  onChange={(e) => setOrgLegalName(e.target.value)}
                  disabled={disabled}
                  data-testid="input-org-legal-name"
                />
              </Field>
            </div>
            <ImagePickerInline
              label="Organization logo"
              helper="SVG or PNG logo used in the JSON-LD and OG markup."
              previewUrl={data.orgLogoUrl ?? null}
              isOverridden={
                data.orgLogoMediaId != null || data.orgLogoAssetId != null
              }
              testIdPrefix="org-logo"
              onPick={() => setPickerOpen("org-logo")}
              onReset={() => handleResetAsset("org-logo")}
              disabled={disabled}
            />
            <Field label="Street address">
              <Input
                placeholder="13300 Bothell Everett Hwy, Suite 303"
                value={orgStreet}
                onChange={(e) => setOrgStreet(e.target.value)}
                disabled={disabled}
                data-testid="input-org-street"
              />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="City">
                <Input
                  placeholder="Mill Creek"
                  value={orgLocality}
                  onChange={(e) => setOrgLocality(e.target.value)}
                  disabled={disabled}
                  data-testid="input-org-locality"
                />
              </Field>
              <Field label="State / Region">
                <Input
                  placeholder="WA"
                  value={orgRegion}
                  onChange={(e) => setOrgRegion(e.target.value)}
                  disabled={disabled}
                  data-testid="input-org-region"
                />
              </Field>
              <Field label="Postal code">
                <Input
                  placeholder="98012"
                  value={orgPostal}
                  onChange={(e) => setOrgPostal(e.target.value)}
                  disabled={disabled}
                  data-testid="input-org-postal"
                />
              </Field>
            </div>
            <Field label="Country code">
              <Input
                placeholder="US"
                value={orgCountry}
                onChange={(e) => setOrgCountry(e.target.value)}
                disabled={disabled}
                data-testid="input-org-country"
                className="w-24"
              />
            </Field>
            <Field
              label="sameAs URLs"
              helper="One absolute URL per entry (LinkedIn, Wikipedia, Wikidata, etc.)."
            >
              <div className="space-y-2">
                {orgSameAs.map((url, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const next = [...orgSameAs];
                        next[i] = e.target.value;
                        setOrgSameAs(next);
                      }}
                      disabled={disabled}
                      placeholder="https://www.linkedin.com/company/synozur"
                      data-testid={`input-org-same-as-${i}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOrgSameAs((prev) => prev.filter((_, j) => j !== i))}
                      disabled={disabled}
                      data-testid={`button-remove-same-as-${i}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOrgSameAs((prev) => [...prev, ""])}
                  disabled={disabled}
                  data-testid="button-add-same-as"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add URL
                </Button>
              </div>
            </Field>
          </SectionCard>

          {/* ── 7. Status ────────────────────────────────────────────────── */}
          <SectionCard
            icon={Activity}
            title="Status"
            description="Current state of sitemap and robots.txt generation."
          >
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Last saved:{" "}
                <span className="text-foreground">
                  {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
                </span>
              </p>
              <p>
                Sitemap:{" "}
                <a
                  href="/sitemap.xml"
                  target="_blank"
                  rel="noreferrer"
                  className="underline inline-flex items-center gap-0.5"
                >
                  /sitemap.xml <ExternalLink className="h-3 w-3" />
                </a>
                {" · "}
                <a
                  href="/robots.txt"
                  target="_blank"
                  rel="noreferrer"
                  className="underline inline-flex items-center gap-0.5"
                >
                  /robots.txt <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <p className="text-xs">
                The sitemap is cached for 5 minutes. Changes to section flags and excluded paths
                will propagate within that window.
              </p>
            </div>
          </SectionCard>

          {/* ── save bar ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <Button
              onClick={handleSave}
              disabled={disabled}
              data-testid="button-save-seo"
            >
              Save SEO settings
            </Button>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              {showSaved && (
                <span
                  className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                  data-testid="text-seo-saved"
                >
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
              {updateMutation.isError && (
                <span className="text-destructive">Failed to save. Please try again.</span>
              )}
            </div>
          </div>
        </div>
      )}

      <MediaPickerModal
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        onSelect={handlePickMedia}
        selectedId={
          pickerOpen === "og-image"
            ? data?.seoDefaultOgImageMediaId ?? null
            : pickerOpen === "org-logo"
              ? data?.orgLogoMediaId ?? null
              : null
        }
      />
    </AdminLayout>
  );
}
