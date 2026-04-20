import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const LOGO_URL = "https://static.wixstatic.com/media/b805ce_7a5d9f47e6df42c6a2dab307ce8c4cf3~mv2.png/v1/fill/w_231,h_63,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/SA-Logo-Horizontal-color.png";

export function Header() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navGroups = [
    {
      title: "Our Story",
      links: [
        { label: "About", href: "/about" },
        { label: "Team", href: "/team" },
        { label: "Careers", href: "/" },
        { label: "Contact", href: "/contact" },
      ]
    },
    {
      title: "Services",
      links: [
        { label: "Services Overview", href: "/services-overview/default" },
        { label: "Strategic Transformation", href: "/services/strategic-transformation" },
        { label: "Technology Transformation", href: "/services/technology-transformation" },
        { label: "Experiences", href: "/services/experiences" },
        { label: "Go-to-Market Transformation", href: "/services/go-to-market-transformation" },
      ]
    },
    {
      title: "The Feed",
      links: [
        { label: "Insights", href: "/insights" },
        { label: "Polaris Podcast", href: "/polaris" },
        { label: "Case Studies", href: "/case-studies" },
      ]
    },
    {
      title: "Applications",
      links: [
        { label: "All Applications", href: "/applications" },
        { label: "Vega", href: "/applications/vega" },
        { label: "Nebula", href: "/applications/nebula" },
        { label: "Constellation", href: "/applications/constellation" },
        { label: "Orion (Models)", href: "/applications/orion" },
        { label: "Orbit", href: "/applications/orbit" },
        { label: "Zenith", href: "/applications/zenith" },
      ]
    },
    {
      title: "Resources",
      links: [
        { label: "Webinars", href: "/" },
        { label: "White Papers", href: "/" },
        { label: "Workshops", href: "/" },
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
                <div className="bg-popover border border-border rounded-md shadow-md p-4 w-64 flex flex-col gap-2">
                  {group.links.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="text-sm text-popover-foreground/80 hover:text-primary hover:bg-muted/50 px-3 py-2 rounded-md transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-4">
          <Link href="/start" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
            Get Started
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>

        {/* Mobile Nav Toggle */}
        <button
          className="lg:hidden p-2 text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
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
