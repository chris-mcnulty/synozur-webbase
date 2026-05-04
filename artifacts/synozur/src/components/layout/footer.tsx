import { Link } from "wouter";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Linkedin, Twitter, Youtube, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getActiveApplications } from "@/data/applications";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";

function FooterSubscribeForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error" | "bot-check-failed">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus("error");
      setErrorMessage("Please complete the bot check before subscribing.");
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      await api.submitSubscribe({ email, source: "footer", website: website || null, turnstileToken });
      setStatus("success");
      setEmail("");
    } catch (err) {
      if (isBotCheckError(err)) {
        setStatus("bot-check-failed");
        setErrorMessage(null);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Could not subscribe. Please try again.",
      );
    }
  };

  if (status === "success") {
    return (
      <p className="text-sm text-primary" role="status">
        Thanks — we&apos;ll be in touch with the next edition of The Feed.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={handleSubmit}
      aria-label="Subscribe to The Feed"
    >
      <div className="flex gap-2">
        <label htmlFor="footer-subscribe-email" className="sr-only">
          Email address
        </label>
        <Input
          id="footer-subscribe-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="max-w-[240px]"
        />
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
        />
        <Button type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "..." : "Subscribe"}
        </Button>
      </div>
      <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} theme="dark" />
      {status === "bot-check-failed" && <BotCheckCallout compact />}
      {status === "error" && errorMessage && (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

type SocialLink = { href: string; label: string; Icon: LucideIcon };

// #268: derive footer social links from the same `orgSameAs` array that
// powers the Organization JSON-LD `sameAs` field. Admins edit it once in
// Site Settings → SEO; the footer only renders an icon when the matching
// profile URL is present, so we never ship anchors that go nowhere.
//
// Mirrors the fallback list baked into `OrganizationJsonLd` so the footer
// and JSON-LD advertise the same profiles when `orgSameAs` is unset in the
// DB. Keep these in sync if either side gains/loses a default profile.
const SAME_AS_FALLBACK: readonly string[] = ["https://www.linkedin.com/company/synozur"];

// Strict host matchers: exact domain or one-level subdomain (e.g. `www.`),
// not arbitrary suffix matches like `evil-linkedin.com`.
const matchesDomain = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

function pickSocialLinks(sameAs: readonly string[] | null | undefined): SocialLink[] {
  const source = sameAs && sameAs.length > 0 ? sameAs : SAME_AS_FALLBACK;
  const matchers: { test: (host: string) => boolean; label: string; Icon: LucideIcon }[] = [
    {
      test: (h) => matchesDomain(h, "linkedin.com"),
      label: "LinkedIn",
      Icon: Linkedin,
    },
    {
      test: (h) => matchesDomain(h, "twitter.com") || matchesDomain(h, "x.com"),
      label: "Twitter",
      Icon: Twitter,
    },
    {
      test: (h) => matchesDomain(h, "youtube.com") || h === "youtu.be",
      label: "YouTube",
      Icon: Youtube,
    },
  ];
  const seen = new Set<string>();
  const out: SocialLink[] = [];
  for (const raw of source) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) continue;
    let host: string;
    try {
      host = new URL(trimmed).hostname.toLowerCase();
    } catch {
      continue;
    }
    for (const m of matchers) {
      if (seen.has(m.label)) continue;
      if (m.test(host)) {
        out.push({ href: trimmed, label: m.label, Icon: m.Icon });
        seen.add(m.label);
        break;
      }
    }
  }
  return out;
}

export function Footer() {
  // #103: applications column reads from the same API endpoint that
  // drives the header nav and the applications list page. Falls back to
  // the static applications list when the API is empty or unreachable,
  // preserving behaviour during migration from hardcoded nav entries.
  const applicationsQuery = useQuery({
    queryKey: ["applications", "nav"],
    queryFn: () => api.listApplications(true),
    staleTime: 5 * 60 * 1000,
  });
  const apiApps = applicationsQuery.data?.items ?? [];
  const footerApps = (
    apiApps.length > 0
      ? apiApps
      : getActiveApplications().map((a) => ({ slug: a.slug, name: a.name }))
  ).slice(0, 4);

  const servicesQuery = useQuery({
    queryKey: ["services", "footer"],
    queryFn: () => api.listServices(),
    staleTime: 5 * 60 * 1000,
  });
  const footerServices = servicesQuery.data?.items ?? [];

  // #268: pull social URLs from public site settings (same query key the
  // header/JSON-LD already share so this hits the cache).
  const settingsQuery = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const socialLinks = pickSocialLinks(settingsQuery.data?.orgSameAs ?? null);

  return (
    <footer className="bg-card border-t border-border pt-16 pb-8">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Find Your North Star</h2>
          <p className="text-muted-foreground text-lg">
            Let us guide your organization's transformation journey. Rooted in people, powered by technology, and driven by purpose.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8 mb-16">
          <div className="lg:col-span-2">
            <h3 className="font-semibold mb-4 text-foreground">Subscribe to The Feed</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Get the latest insights, models, and episodes of Polaris delivered to your inbox.
            </p>
            <FooterSubscribeForm />
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Services</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {footerServices.length > 0
                ? footerServices.map((s) => (
                    <li key={s.slug}>
                      <Link href={s.servicePath ?? `/services/${s.slug}`} className="hover:text-primary transition-colors">{s.title}</Link>
                    </li>
                  ))
                : (
                  <>
                    <li><Link href="/services/strategic-transformation" className="hover:text-primary transition-colors">Strategic Transformation</Link></li>
                    <li><Link href="/services/technology-transformation" className="hover:text-primary transition-colors">Technology Transformation</Link></li>
                    <li><Link href="/services/experiences" className="hover:text-primary transition-colors">Experiences</Link></li>
                    <li><Link href="/services/go-to-market-transformation" className="hover:text-primary transition-colors">Go-to-Market Transformation</Link></li>
                  </>
                )
              }
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Applications</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/applications" className="hover:text-primary transition-colors">All Applications</Link></li>
              {footerApps.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/applications/${a.slug}`}
                    className="hover:text-primary transition-colors"
                  >
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Company</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/about" className="hover:text-primary transition-colors">Our Story</Link></li>
              <li><Link href="/team" className="hover:text-primary transition-colors">Leadership</Link></li>
              <li><Link href="/partners" className="hover:text-primary transition-colors">Partners</Link></li>
              <li><Link href="/clients" className="hover:text-primary transition-colors">Clients</Link></li>
              <li><Link href="/careers" className="hover:text-primary transition-colors" data-testid="footer-careers-link">Careers</Link></li>
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Connect</h3>
            {socialLinks.length > 0 && (
              <div className="flex gap-4 mb-6">
                {socialLinks.map(({ href, label, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    aria-label={label}
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                ))}
              </div>
            )}
            <Link href="/start" className="inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
              Get Started <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="pt-8 border-t border-border flex flex-col gap-6 text-sm text-muted-foreground">
          <address className="not-italic text-center md:text-left">
            13300 Bothell Everett Hwy, Suite 303, Mill Creek, WA 98012
          </address>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-center md:text-left">
              © {new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved. Synozur and The Synozur Alliance are trademarks of The Synozur Alliance, LLC.
            </p>
            <div className="flex gap-6 shrink-0">
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
