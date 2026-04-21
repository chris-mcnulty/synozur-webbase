import { Link, useLocation } from "wouter";
import { Menu, X, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/ui/theme-toggle";

type NavLink = { label: string; href: string };
type NavGroup = { title: string; links: NavLink[]; nested?: { label: string; href: string; children: NavLink[] }[] };

const LOGO_URL = "https://static.wixstatic.com/media/b805ce_7a5d9f47e6df42c6a2dab307ce8c4cf3~mv2.png/v1/fill/w_231,h_63,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/SA-Logo-Horizontal-color.png";

export function Header() {
  useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
    staleTime: 5 * 60 * 1000,
  });

  const pillars = (servicesQuery.data?.items ?? []).filter(
    (s) => s.slug !== "our-services",
  );

  const servicesGroup: NavGroup = {
    title: "Services",
    links: [{ label: "Services Overview", href: "/services-overview/default" }],
    nested: pillars.map((p) => ({
      label: p.title,
      href: `/services/${p.slug}`,
      children: p.solutions.map((s) => ({
        label: s.title,
        href: `/solutions/${s.slug}`,
      })),
    })),
  };

  const navGroups: NavGroup[] = [
    {
      title: "Our Story",
      links: [
        { label: "About", href: "/about" },
        { label: "Team", href: "/team" },
        { label: "Careers", href: "/" },
        { label: "Contact", href: "/contact" },
      ]
    },
    servicesGroup,
    {
      title: "The Feed",
      links: [
        { label: "Insights", href: "/insights" },
        { label: "Polaris Podcast", href: "/polaris" },
        { label: "Case Studies", href: "/case-studies" },
        { label: "Events", href: "/events" },
      ]
    },
    {
      title: "Resources",
      links: [
        { label: "Webinars", href: "/webinars" },
        { label: "White Papers", href: "/items" },
        { label: "Workshops", href: "/workshops" },
        { label: "Browse Library", href: "/library" },
        { label: "All Applications", href: "/applications" },
        { label: "Vega", href: "/applications/vega" },
        { label: "Nebula", href: "/applications/nebula" },
        { label: "Constellation", href: "/applications/constellation" },
        { label: "Orion (Models)", href: "/applications/orion" },
        { label: "Orbit", href: "/applications/orbit" },
        { label: "Zenith", href: "/applications/zenith" },
      ]
    }
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <img src={LOGO_URL} alt="The Synozur Alliance Logo" className="h-10 w-auto" />
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {navGroups.map((group) => (
            <div key={group.title} className="relative group">
              <button
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2"
                aria-haspopup="true"
              >
                {group.title}
              </button>
              <div className="absolute left-0 top-full pt-2 opacity-0 translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200 z-50">
                <div
                  className={`bg-popover border border-border rounded-md shadow-md p-4 flex flex-col gap-2 ${
                    group.nested && group.nested.length > 0 ? "w-[28rem]" : "w-64"
                  }`}
                >
                  {group.links.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="text-sm text-popover-foreground/80 hover:text-primary hover:bg-muted/50 px-3 py-2 rounded-md transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}
                  {group.nested && group.nested.length > 0 ? (
                    <div className="border-t border-border/60 pt-3 mt-1 flex flex-col gap-3">
                      {group.nested.map((pillar) => (
                        <div key={pillar.label}>
                          <Link
                            href={pillar.href}
                            className="block text-sm font-semibold text-popover-foreground hover:text-primary px-3 py-1 rounded-md"
                          >
                            {pillar.label}
                          </Link>
                          {pillar.children.length > 0 ? (
                            <ul className="pl-3 mt-1 space-y-0.5">
                              {pillar.children.map((c) => (
                                <li key={c.href}>
                                  <Link
                                    href={c.href}
                                    className="block text-xs text-popover-foreground/70 hover:text-primary hover:bg-muted/40 px-3 py-1 rounded-md"
                                  >
                                    {c.label}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-3">
          <ThemeToggle />
          <Link href="/start" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
            Get Started
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>

        {/* Mobile Nav Toggle */}
        <div className="lg:hidden flex items-center gap-2">
          <ThemeToggle />
          <button
            className="p-2 text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 w-full h-[calc(100vh-5rem)] bg-background border-t border-border overflow-y-auto z-40">
          <div className="p-6 flex flex-col gap-6">
            {navGroups.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h3 className="font-semibold text-foreground">{group.title}</h3>
                <div className="flex flex-col gap-2 pl-4 border-l border-border/50">
                  {group.links.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="text-muted-foreground hover:text-primary py-1"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {link.label}
                    </Link>
                  ))}
                  {group.nested?.map((pillar) => (
                    <div key={pillar.label} className="mt-2">
                      <Link
                        href={pillar.href}
                        className="block font-medium text-foreground/90 hover:text-primary py-1"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {pillar.label}
                      </Link>
                      {pillar.children.length > 0 ? (
                        <ul className="pl-4 border-l border-border/40 ml-1 mt-1 space-y-1">
                          {pillar.children.map((c) => (
                            <li key={c.href}>
                              <Link
                                href={c.href}
                                className="block text-sm text-muted-foreground hover:text-primary py-0.5"
                                onClick={() => setMobileMenuOpen(false)}
                              >
                                {c.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="pt-6 mt-6 border-t border-border">
              <Link 
                href="/start" 
                className="flex w-full h-12 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                onClick={() => setMobileMenuOpen(false)}
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
