import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const CONSENT_KEY = "synozur.cookieConsent.v1";

type Consent = "granted" | "denied" | null;

function readConsent(): Consent {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

function writeConsent(value: "granted" | "denied") {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // ignore
  }
}

function injectScript(id: string, src: string, attrs: Record<string, string> = {}) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
  document.head.appendChild(s);
}

function injectInline(id: string, code: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.text = code;
  document.head.appendChild(s);
}

function loadGA4(id: string) {
  injectScript("ga4-loader", `https://www.googletagmanager.com/gtag/js?id=${id}`);
  injectInline(
    "ga4-init",
    `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`,
  );
}

function loadLinkedIn(partnerId: string) {
  injectInline(
    "li-init",
    `_linkedin_partner_id="${partnerId}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);`,
  );
  injectInline(
    "li-loader",
    `(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})(window.lintrk);`,
  );
}

function loadMetaPixel(id: string) {
  injectInline(
    "fbq-init",
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`,
  );
}

function loadMarketingTags() {
  const env = import.meta.env as Record<string, string | undefined>;
  const ga4 = env.VITE_GA4_ID;
  const li = env.VITE_LINKEDIN_PARTNER_ID ?? "7337793";
  const meta = env.VITE_META_PIXEL_ID;
  if (ga4) loadGA4(ga4);
  if (li) loadLinkedIn(li);
  if (meta) loadMetaPixel(meta);
}

export function Analytics() {
  const { data: settings, isLoading } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 60_000,
    retry: false,
  });

  const requireConsent = settings?.requireCookieConsent === true;

  const [consent, setConsent] = useState<Consent>(() => readConsent());

  useEffect(() => {
    if (isLoading || !settings) return;
    if (!requireConsent) {
      loadMarketingTags();
      return;
    }
    if (consent === "granted") loadMarketingTags();
  }, [isLoading, settings, requireConsent, consent]);

  if (isLoading || !settings) return null;
  if (!requireConsent) return null;
  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 rounded-lg border border-border bg-card/95 backdrop-blur-md shadow-2xl p-5"
    >
      <p className="text-sm text-foreground mb-2 font-semibold">We use cookies</p>
      <p className="text-sm text-muted-foreground mb-4">
        We use cookies and similar technologies to measure site performance and improve your
        experience. You can accept or decline marketing cookies.
      </p>
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={() => {
            writeConsent("denied");
            setConsent("denied");
          }}
          className="text-sm px-4 py-2 rounded-md border border-border text-foreground hover:bg-muted transition-colors"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => {
            writeConsent("granted");
            setConsent("granted");
          }}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
