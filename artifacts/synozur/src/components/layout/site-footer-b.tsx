import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { getActiveApplications } from "@/data/applications";
import { FooterSubscribeForm } from "./footer";
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

const INSIGHTS_LINKS = [
  { label: "Articles", href: "/insights" },
  { label: "White Papers", href: "/white-papers" },
  { label: "Podcast", href: "/polaris" },
  { label: "Events", href: "/events" },
];

const RESOURCES_LINKS = [
  { label: "Case Studies", href: "/case-studies" },
  { label: "Webinars", href: "/webinars" },
  { label: "Workshops", href: "/workshops" },
  { label: "Models", href: "/models" },
  { label: "FAQ", href: "/faq" },
  { label: "Browse Library", href: "/library" },
];

// The B-experience footer. Carries the unified decision-path branding from the
// Canvas mockup ("Find Your North Star", subscribe + connect band, five link
// columns) but every link resolves to a real route and the Solutions /
// Applications columns are data-driven — mirroring the mainline footer so the
// two stay in sync.
export function SiteFooterB() {
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

  const solutionsMenuQuery = useQuery({
    queryKey: ["solutions", "menu"],
    queryFn: () => api.listSolutions({ showInMenu: true }),
    staleTime: 5 * 60 * 1000,
  });
  const solutionItems: NavSolutionItem[] = (solutionsMenuQuery.data?.items ?? [])
    .filter((s) => !!s.solutionGroup)
    .map((s) => ({
      title: s.title,
      slug: s.slug,
      solutionGroup: s.solutionGroup as NavSolutionGroup,
    }));
  const groupedSolutions = partitionSolutionsByGroup(solutionItems);
  const footerFeatured = (["ai_strategy", "gtm", "company_os"] as const)
    .map((k) => {
      const first = groupedSolutions[k][0];
      return first ? { label: SOLUTION_GROUP_LABELS[k], slug: first.slug } : null;
    })
    .filter((x): x is { label: string; slug: string } => !!x);
  const hasConsulting = groupedSolutions.consulting_services.length > 0;

  const settingsQuery = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const socialLinks = pickSocialLinks(settingsQuery.data?.orgSameAs ?? null);

  return (
    <footer className="bg-card border-t border-border pt-16 pb-8">
      <div className="container mx-auto px-4 md:px-6">
        {/* Closing CTA heading */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Find Your <span className="nebula-text">North Star</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            Ready to move from AI-ready to AI-first? Synozur guides leaders through every phase
            of transformation — strategy that sticks, AI that delivers, and progress you can
            measure.
          </p>
        </div>

        {/* Subscribe + Connect band */}
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr] pb-12 border-b border-border">
          <div className="max-w-md">
            <h3 className="font-semibold mb-3 text-foreground">Subscribe to The Feed</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Get the latest insights, models, and episodes of Polaris delivered to your inbox.
            </p>
            <FooterSubscribeForm />
          </div>

          <div className="lg:text-right">
            <h3 className="font-semibold mb-4 text-foreground">Connect</h3>
            {socialLinks.length > 0 && (
              <div className="flex gap-4 mb-5 lg:justify-end">
                {socialLinks.map(({ href, label, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                ))}
              </div>
            )}
            <Link
              href="/start"
              className="inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              Get Started <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 py-12">
          {/* About */}
          <div>
            <h3 className="font-semibold mb-4 text-foreground">About</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {FOOTER_COMPANY_LINKS.map((link) => {
                const isExternal = /^https?:\/\//.test(link.href);
                return (
                  <li key={link.href}>
                    {isExternal ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors"
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

          {/* Solutions (data-driven) */}
          <div>
            <h3 className="font-semibold mb-4 text-foreground">Solutions</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {footerFeatured.map((f) => (
                <li key={f.slug}>
                  <Link
                    href={`/solutions/${f.slug}`}
                    className="hover:text-primary transition-colors"
                  >
                    {f.label}
                  </Link>
                </li>
              ))}
              {hasConsulting && (
                <li>
                  <Link
                    href="/services-overview/default"
                    className="hover:text-primary transition-colors"
                  >
                    Consulting Services
                  </Link>
                </li>
              )}
            </ul>
          </div>

          {/* Applications (data-driven) */}
          <div>
            <h3 className="font-semibold mb-4 text-foreground">Applications</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <Link href="/applications" className="hover:text-primary transition-colors">
                  All Applications
                </Link>
              </li>
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

          {/* Insights */}
          <div>
            <h3 className="font-semibold mb-4 text-foreground">Insights</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {INSIGHTS_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold mb-4 text-foreground">Resources</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {RESOURCES_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-border flex flex-col gap-6 text-sm text-muted-foreground">
          <address className="not-italic text-center md:text-left">{ORG_ADDRESS}</address>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-center md:text-left">
              © {new Date().getFullYear()} {ORG_COPYRIGHT_NAME}
            </p>
            <div className="flex gap-6 shrink-0">
              {FOOTER_LEGAL_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="hover:text-foreground transition-colors"
                >
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
