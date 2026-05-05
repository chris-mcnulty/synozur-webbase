import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";
import {
  pickSocialLinks,
  FOOTER_STATIC_SERVICES,
  FOOTER_STATIC_APPLICATIONS,
  FOOTER_COMPANY_LINKS,
  FOOTER_LEGAL_LINKS,
  ORG_ADDRESS,
  ORG_COPYRIGHT_NAME,
} from "@workspace/synozur-nav";

type ApiApplication = { slug: string; name: string };
type ApiService = { slug: string; title: string; servicePath?: string | null };

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
      const res = await fetch("/api/forms/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "galaxy-portal-footer",
          website: website || null,
          turnstileToken: turnstileToken ?? null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (data.code === "bot_check_failed" || isBotCheckError(data)) {
          setStatus("bot-check-failed");
          setErrorMessage(null);
          setTurnstileToken(null);
          turnstileRef.current?.reset();
          return;
        }
        throw new Error(data.error ?? "Could not subscribe. Please try again.");
      }
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
      setErrorMessage(err instanceof Error ? err.message : "Could not subscribe. Please try again.");
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
    <form className="flex flex-col gap-2" onSubmit={handleSubmit} aria-label="Subscribe to The Feed">
      <div className="flex gap-2">
        <label htmlFor="galaxy-footer-subscribe-email" className="sr-only">Email address</label>
        <input
          id="galaxy-footer-subscribe-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="h-10 flex-1 max-w-[240px] rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {/* honeypot — hidden from real users, catches bots */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "submitting" ? "…" : "Subscribe"}
        </button>
      </div>
      <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} theme="dark" />
      {status === "bot-check-failed" && <BotCheckCallout compact />}
      {status === "error" && errorMessage && (
        <p className="text-xs text-destructive" role="alert">{errorMessage}</p>
      )}
    </form>
  );
}

export function PortalSiteFooter() {
  const year = new Date().getFullYear();

  const applicationsQuery = useQuery({
    queryKey: ["galaxy-footer-applications"],
    queryFn: async () => {
      const res = await fetch("/api/applications?active=true");
      if (!res.ok) return { items: [] as ApiApplication[] };
      return res.json() as Promise<{ items: ApiApplication[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const servicesQuery = useQuery({
    queryKey: ["galaxy-footer-services"],
    queryFn: async () => {
      const res = await fetch("/api/services");
      if (!res.ok) return { items: [] as ApiService[] };
      return res.json() as Promise<{ items: ApiService[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const settingsQuery = useQuery({
    queryKey: ["galaxy-footer-settings"],
    queryFn: async () => {
      const res = await fetch("/api/site-settings");
      if (!res.ok) return null;
      return res.json() as Promise<{ orgSameAs?: string[] }>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const footerApps = (applicationsQuery.data?.items ?? []).slice(0, 4);
  const footerServices = servicesQuery.data?.items ?? [];
  const socialLinks = pickSocialLinks(settingsQuery.data?.orgSameAs ?? null);

  return (
    <footer className="bg-card border-t border-border pt-16 pb-8">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Find Your North Star</h2>
          <p className="text-muted-foreground text-lg">
            Let us guide your organization&apos;s transformation journey. Rooted in people, powered by technology, and driven by purpose.
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
                      <a href={s.servicePath ?? `/services/${s.slug}`} className="hover:text-primary transition-colors">{s.title}</a>
                    </li>
                  ))
                : FOOTER_STATIC_SERVICES.map((s) => (
                    <li key={s.slug}>
                      <a href={`/services/${s.slug}`} className="hover:text-primary transition-colors">{s.title}</a>
                    </li>
                  ))
              }
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Applications</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><a href="/applications" className="hover:text-primary transition-colors">All Applications</a></li>
              {footerApps.length > 0
                ? footerApps.map((a) => (
                    <li key={a.slug}>
                      <a href={`/applications/${a.slug}`} className="hover:text-primary transition-colors">{a.name}</a>
                    </li>
                  ))
                : FOOTER_STATIC_APPLICATIONS.map((a) => (
                    <li key={a.slug}>
                      <a href={`/applications/${a.slug}`} className="hover:text-primary transition-colors">{a.name}</a>
                    </li>
                  ))
              }
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Company</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {FOOTER_COMPANY_LINKS.map((link) => {
                const isExternal = /^https?:\/\//.test(link.href);
                return (
                  <li key={link.href}>
                    {isExternal ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">{link.label}</a>
                    ) : (
                      <a href={link.href} className="hover:text-primary transition-colors">{link.label}</a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Connect</h3>
            {socialLinks.length > 0 && (
              <div className="flex gap-4 mb-6">
                {socialLinks.map(({ href, label, Icon }) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors" aria-label={label}>
                    <Icon className="h-5 w-5" />
                  </a>
                ))}
              </div>
            )}
            <a href="/start" className="inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
              Get Started <ArrowRight className="ml-1 h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="pt-8 border-t border-border flex flex-col gap-6 text-sm text-muted-foreground">
          <address className="not-italic text-center md:text-left">
            {ORG_ADDRESS}
          </address>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-center md:text-left">
              © {year} {ORG_COPYRIGHT_NAME}
            </p>
            <div className="flex gap-6 shrink-0">
              {FOOTER_LEGAL_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="hover:text-foreground transition-colors">{link.label}</a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
