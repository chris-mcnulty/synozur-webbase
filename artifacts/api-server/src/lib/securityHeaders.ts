import helmet from "helmet";
import type { RequestHandler } from "express";
import { logger } from "./logger";

// #155 / launch readiness L4 — Security headers via helmet.
//
// Rolled out in two phases:
//   1. Report-only CSP (default) — browsers post violations to
//      /api/csp/report but never block resources. Run for ≥ 7 days against
//      production traffic per BACKLOG.md "SEO & web-platform debt" #1.
//   2. Enforcing CSP (CSP_ENFORCE=1) — flip once the violation stream is
//      empty for two consecutive days.
//
// The CSP allowlist mirrors the third-party tags loaded in the SPA's
// components/analytics.tsx (GA4, LinkedIn Insight, Meta Pixel), the
// embedded surfaces (YouTube, Microsoft Bookings, Google Fonts), the
// Cloudflare Turnstile widget on contact/subscribe/start forms, and the
// Libsyn player on the Polaris page. Keep this in sync with the equivalent
// config in artifacts/synozur/server.mjs.

export const CSP_REPORT_PATH = "/api/csp/report";

const CSP_ENFORCE = process.env.CSP_ENFORCE === "1";

const CSP_DIRECTIVES: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  // GA4, LinkedIn, Meta, and the inline pre-hydration theme script all need
  // 'unsafe-inline'; same-origin Vite-built bundles are covered by 'self'.
  // Cloudflare Turnstile loads its widget JS from challenges.cloudflare.com.
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://snap.licdn.com",
    "https://connect.facebook.net",
    "https://challenges.cloudflare.com",
  ],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "blob:", "https:"],
  mediaSrc: ["'self'", "data:", "blob:", "https:"],
  // Cloudflare Turnstile renders its challenge inside a Turnstile-hosted iframe.
  // Podcast, video, and other rich-media embeds inserted via the CMS editor.
  frameSrc: [
    "'self'",
    // Video
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
    "https://vimeo.com",
    // Podcast players
    "https://play.libsyn.com",
    "https://html5-player.libsyn.com",
    "https://www.buzzsprout.com",
    "https://open.spotify.com",
    "https://embed.podcasts.apple.com",
    "https://anchor.fm",
    "https://player.captivate.fm",
    "https://www.podbean.com",
    "https://share.transistor.fm",
    "https://w.soundcloud.com",
    "https://www.iheart.com",
    "https://omny.fm",
    "https://player.simplecast.com",
    "https://embed.acast.com",
    "https://listen.pocketcasts.com",
    "https://www.podtrac.com",
    // Scheduling / booking
    "https://outlook.office365.com",
    "https://*.bookings.microsoft.com",
    // Other
    "https://www.google.com",
    "https://challenges.cloudflare.com",
  ],
  // Cloudflare Turnstile makes validation XHR calls back to challenges.cloudflare.com.
  connectSrc: [
    "'self'",
    "https://www.google-analytics.com",
    "https://*.analytics.google.com",
    "https://stats.g.doubleclick.net",
    "https://px.ads.linkedin.com",
    "https://www.facebook.com",
    "https://challenges.cloudflare.com",
  ],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  reportUri: [CSP_REPORT_PATH],
};

export function securityHeadersMiddleware(): RequestHandler {
  return helmet({
    // HSTS: 2 years, include subdomains, preload-eligible. Safe to enable
    // because synozur.com already serves HTTPS exclusively.
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: {
      useDefaults: false,
      reportOnly: !CSP_ENFORCE,
      directives: CSP_DIRECTIVES,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // X-Frame-Options DENY in addition to the CSP frame-ancestors none — old
    // browsers fall back to the legacy header.
    frameguard: { action: "deny" },
    // crossOriginEmbedderPolicy enables COEP, which blocks third-party iframes
    // (YouTube, Bookings) without explicit CORP headers — leave off.
    crossOriginEmbedderPolicy: false,
    // crossOriginResourcePolicy "same-origin" would block third-party
    // consumers of /api/og preview HTML — leave at the relaxed default.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  });
}

export function logSecurityHeaderConfig(): void {
  if (CSP_ENFORCE) {
    logger.info("Security headers: CSP is in ENFORCING mode (CSP_ENFORCE=1)");
  } else {
    logger.info(
      `Security headers: CSP is in REPORT-ONLY mode — violations posted to ${CSP_REPORT_PATH}. Set CSP_ENFORCE=1 to flip to enforcing.`,
    );
  }
}
