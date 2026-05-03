import { useEffect, useState } from "react";
import { Facebook, Linkedin, Link as LinkIcon, Check, Share2 } from "lucide-react";

export type ShareTarget = "linkedin" | "x" | "facebook" | "copy" | "native";

export interface ShareRailProps {
  /**
   * Editorial kind — used as a prefix on test ids so multiple rails on
   * a page can be disambiguated, and as the default visible label
   * suffix when `label` is not supplied. Should be a slug-style string
   * (e.g. `"insight"`, `"case-study"`, `"white-paper"`).
   */
  kind: string;
  /**
   * Optional human-readable noun used in the heading
   * ("Share this <label>"). Defaults to `kind`. Pass this when `kind`
   * is hyphenated so the heading reads naturally
   * (e.g. `kind="case-study" label="case study"`).
   */
  label?: string;
  /**
   * Title of the content. Used as pre-filled tweet text and as the
   * `navigator.share` title.
   */
  title: string;
  /**
   * Absolute URL of the content. When omitted, falls back to
   * `window.location.href` at render time. Provided as a prop mainly
   * so SSR/tests can inject deterministic URLs.
   */
  url?: string;
  /**
   * Which share targets to render and in what order. Defaults to the
   * full set: LinkedIn, X, Facebook, copy-link, plus the
   * `navigator.share` mobile fallback.
   */
  targets?: ShareTarget[];
  /**
   * Optional className applied to the wrapper, mainly so callers can
   * tweak top spacing/border (e.g. event-detail uses a top border +
   * pt-6, insight-detail uses a card panel).
   */
  className?: string;
}

function XIcon({ className }: { className?: string }) {
  // Lucide doesn't ship an X/Twitter glyph; inline SVG keeps us off extra deps.
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2H21.5l-7.52 8.593L22.9 22h-6.93l-5.43-6.84L4.2 22H.94l8.04-9.194L1.1 2h7.09l4.9 6.28L18.244 2Zm-1.22 18h1.913L7.07 4H5.05l11.974 16Z" />
    </svg>
  );
}

const DEFAULT_TARGETS: ShareTarget[] = [
  "linkedin",
  "x",
  "facebook",
  "copy",
  "native",
];

const BUTTON_BASE =
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors";

export function ShareRail({
  kind,
  label,
  title,
  url,
  targets = DEFAULT_TARGETS,
  className,
}: ShareRailProps) {
  const headingLabel = label ?? kind;
  // Resolve the share URL at mount time, not render time. SSR doesn't
  // have `window`, and we want the rail to hydrate with the user's
  // actual URL (including any `?utm_*` params they landed with).
  const [resolvedUrl, setResolvedUrl] = useState<string>(url ?? "");
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    if (url) {
      setResolvedUrl(url);
    } else if (typeof window !== "undefined") {
      setResolvedUrl(window.location.href);
    }
  }, [url]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanNativeShare(true);
    }
  }, []);

  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(resolvedUrl)}`;
  const xHref = `https://twitter.com/intent/tweet?url=${encodeURIComponent(resolvedUrl)}&text=${encodeURIComponent(title)}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(resolvedUrl)}`;

  async function handleCopy() {
    if (!resolvedUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resolvedUrl);
      } else {
        // Fallback for older browsers / non-secure contexts.
        const textarea = document.createElement("textarea");
        textarea.value = resolvedUrl;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Swallow — copy failures shouldn't break the page.
    }
  }

  async function handleNativeShare() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title, url: resolvedUrl });
    } catch {
      // User cancelled or share failed — no-op.
    }
  }

  return (
    <div className={className ?? "mt-10 pt-6 border-t border-border"} data-testid={`share-rail-${kind}`}>
      <p className="text-sm font-medium mb-3">Share this {headingLabel}</p>
      <div className="flex items-center gap-3">
        {targets.includes("linkedin") && (
          <a
            href={linkedinHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Share on LinkedIn"
            className={BUTTON_BASE}
            data-testid="share-linkedin"
          >
            <Linkedin className="h-4 w-4" />
          </a>
        )}
        {targets.includes("x") && (
          <a
            href={xHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Share on X"
            className={BUTTON_BASE}
            data-testid="share-x"
          >
            <XIcon className="h-3.5 w-3.5" />
          </a>
        )}
        {targets.includes("facebook") && (
          <a
            href={facebookHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Share on Facebook"
            className={BUTTON_BASE}
            data-testid="share-facebook"
          >
            <Facebook className="h-4 w-4" />
          </a>
        )}
        {targets.includes("copy") && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : "Copy link"}
            className={BUTTON_BASE}
            data-testid="share-copy"
            data-copied={copied ? "true" : "false"}
          >
            {copied ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <LinkIcon className="h-4 w-4" />
            )}
          </button>
        )}
        {targets.includes("native") && canNativeShare && (
          <button
            type="button"
            onClick={handleNativeShare}
            aria-label="Share via device"
            className={`${BUTTON_BASE} md:hidden`}
            data-testid="share-native"
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default ShareRail;
