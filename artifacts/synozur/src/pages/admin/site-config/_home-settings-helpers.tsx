import { Image as ImageIcon, Video as VideoIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Shared UI helpers used by both site-settings.tsx (main home) and
// alt-home.tsx (home-b overrides).
// ---------------------------------------------------------------------------

export interface ImagePickerProps {
  label: string;
  helper: string;
  previewUrl: string;
  isOverridden: boolean;
  testIdPrefix: string;
  onPick: () => void;
  onReset: () => void;
  disabled: boolean;
  resetLabel?: string;
}

export function ImagePicker({
  label,
  helper,
  previewUrl,
  isOverridden,
  testIdPrefix,
  onPick,
  onReset,
  disabled,
  resetLabel,
}: ImagePickerProps) {
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
              <X className="h-4 w-4 mr-1" /> {resetLabel ?? "Reset to default"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface VideoPickerProps {
  label: string;
  helper: string;
  isOverridden: boolean;
  originalName: string | null;
  previewUrl?: string | null;
  testIdPrefix: string;
  onPick: () => void;
  onReset: () => void;
  disabled: boolean;
  emptyLabel?: string;
  resetLabel?: string;
}

export function VideoPicker({
  label,
  helper,
  isOverridden,
  originalName,
  previewUrl,
  testIdPrefix,
  onPick,
  onReset,
  disabled,
  emptyLabel,
  resetLabel,
}: VideoPickerProps) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{helper}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-40 h-24 rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center relative">
          {isOverridden && previewUrl ? (
            <>
              <video
                key={previewUrl}
                src={previewUrl}
                className="w-full h-full object-cover"
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                data-testid={`${testIdPrefix}-preview`}
              />
              {originalName && (
                <span
                  className="absolute bottom-0 left-0 right-0 text-[10px] text-white bg-black/60 truncate px-1 py-0.5"
                  title={originalName}
                >
                  {originalName}
                </span>
              )}
            </>
          ) : isOverridden ? (
            <div className="flex flex-col items-center gap-1 p-2 text-center">
              <VideoIcon className="h-8 w-8 text-primary" />
              {originalName && (
                <span
                  className="text-[10px] text-muted-foreground truncate w-full px-1"
                  title={originalName}
                >
                  {originalName}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 p-2 text-center">
              <VideoIcon className="h-8 w-8 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                {emptyLabel ?? "Bundled default"}
              </span>
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
              <X className="h-4 w-4 mr-1" /> {resetLabel ?? "Reset to default"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface AltHomeSectionProps {
  heroUrl: string | null;
  heroFallback: string;
  heroVideoUrl: string | null;
  inheritedVideoUrl: string | null;
  heroBgType: "image" | "video" | null;
  inheritedHeroBgType: "image" | "video";
  onOpenHero: () => void;
  onOpenVideo: () => void;
  onResetHero: () => void;
  onResetVideo: () => void;
  onHeroBgTypeChange: (type: "image" | "video" | null) => void;
  disabled: boolean;
}

export function AltHomeSection(props: AltHomeSectionProps) {
  const effectiveType = props.heroBgType ?? props.inheritedHeroBgType;
  return (
    <div className="rounded-md border border-border p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Hero background</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Optional overrides for the /home-b hero. Leave any control on{" "}
          <em>Inherit from Home</em> to keep that piece in sync with the original homepage
          settings. Use this when you want /home-b to diverge visually without touching
          the original page.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Hero background type</div>
        <p className="text-xs text-muted-foreground">
          Override the hero background type just for /home-b, or keep it in sync with the
          original homepage.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          {([null, "image", "video"] as const).map((type) => {
            const active = props.heroBgType === type;
            const label =
              type === null
                ? `Inherit from Home (${props.inheritedHeroBgType})`
                : type === "image"
                  ? "Image"
                  : "Video";
            const description =
              type === null
                ? "Use whatever the original homepage hero is configured to use."
                : type === "image"
                  ? "Force a static image hero on /home-b only."
                  : "Force a looping background video on /home-b only.";
            return (
              <button
                key={type ?? "inherit"}
                type="button"
                disabled={props.disabled}
                data-testid={`homeb-hero-bg-type-${type ?? "inherit"}`}
                onClick={() => props.onHeroBgTypeChange(type)}
                className={`flex-1 text-left rounded-lg border-2 px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                  active
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{label}</span>
                  {active && (
                    <span className="text-xs font-medium text-primary px-2 py-0.5 rounded-full bg-primary/10">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{description}</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Effective on /home-b: <strong>{effectiveType}</strong>
        </p>
      </div>

      <ImagePicker
        label="Hero background image"
        helper="Cosmic / starry background shown on /home-b. Clear the override to inherit the original homepage hero image. Filter: north-star."
        previewUrl={props.heroUrl ?? props.heroFallback}
        isOverridden={props.heroUrl != null}
        testIdPrefix="homeb-hero"
        onPick={props.onOpenHero}
        onReset={props.onResetHero}
        disabled={props.disabled}
        resetLabel="Inherit from Home"
      />

      <VideoPicker
        label="Hero background video"
        helper="Custom video for the /home-b hero. Clear the override to inherit whatever video (or bundled default) the original homepage is using."
        isOverridden={props.heroVideoUrl != null}
        originalName={
          props.heroVideoUrl
            ? "Custom video"
            : props.inheritedVideoUrl
              ? "Inherited from Home"
              : null
        }
        previewUrl={props.heroVideoUrl ?? props.inheritedVideoUrl}
        testIdPrefix="homeb-hero-video"
        onPick={props.onOpenVideo}
        onReset={props.onResetVideo}
        disabled={props.disabled}
        emptyLabel={props.inheritedVideoUrl ? "Inherits Home video" : "Inherits bundled default"}
        resetLabel="Inherit from Home"
      />
    </div>
  );
}
