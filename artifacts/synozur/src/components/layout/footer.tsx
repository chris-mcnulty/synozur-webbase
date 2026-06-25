import { Link } from "wouter";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
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
import {
  pickSocialLinks,
  FOOTER_COMPANY_LINKS,
  FOOTER_LEGAL_LINKS,
  ORG_ADDRESS,
  ORG_COPYRIGHT_NAME,
  SOLUTION_GROUP_LABELS,
  partitionSolutionsByGroup,
  type NavSolutionItem,
  type NavSolutionGroup,
} from "@workspace/synozur-nav";

export function FooterSubscribeForm() {
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

  // Task #317 — footer Solutions column is the same post-Board taxonomy
  // as the header: featured trio first, then a single link to the full
  // Consulting Services list.
  const solutionsMenuQuery = useQuery({
    queryKey: ["solutions", "menu"],
    queryFn: () => api.listSolutions({ showInMenu: true }),
    staleTime: 5 * 60 * 1000,
  });
  const solutionItems: NavSolutionItem[] = (
    solutionsMenuQuery.data?.items ?? []
  )
    .filter((s) => !!s.solutionGroup)
    .map((s) => ({
      title: s.title,
      slug: s.slug,
      solutionGroup: s.solutionGroup as NavSolutionGroup,
    }));
  const groupedSolutions = partitionSolutionsByGroup(solutionItems);
  const footerFeatured = (
    ["ai_strategy", "gtm", "company_os"] as const
  )
    .map((k) => {
      const first = groupedSolutions[k][0];
      return first
        ? { label: SOLUTION_GROUP_LABELS[k], slug: first.slug }
        : null;
    })
    .filter((x): x is { label: string; slug: string } => !!x);
  const hasConsulting = groupedSolutions.consulting_services.length > 0;

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
            Ready to move from AI-ready to AI-first? Synozur guides leaders through every phase of transformation — strategy that sticks, AI that delivers, and progress you can measure.
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
            <h3 className="font-semibold mb-4 text-foreground">Solutions</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {footerFeatured.map((f) => (
                <li key={f.slug}>
                  <Link href={`/solutions/${f.slug}`} className="hover:text-primary transition-colors">{f.label}</Link>
                </li>
              ))}
              {hasConsulting && (
                <li>
                  <Link href="/services-overview/default" className="hover:text-primary transition-colors">Consulting Services</Link>
                </li>
              )}
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
              {FOOTER_COMPANY_LINKS.map((link) => {
                const isExternal = /^https?:\/\//.test(link.href);
                const isCareers = link.label === "Careers";
                return (
                  <li key={link.href}>
                    {isExternal ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors"
                        {...(isCareers ? { "data-testid": "footer-careers-link" } : {})}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="hover:text-primary transition-colors">
                        {link.label}
                      </Link>
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
            {ORG_ADDRESS}
          </address>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-center md:text-left">
              © {new Date().getFullYear()} {ORG_COPYRIGHT_NAME}
            </p>
            <div className="flex gap-6 shrink-0">
              {FOOTER_LEGAL_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-foreground transition-colors">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
