import React, { useState, useEffect } from "react";
import {
  Menu,
  X,
  ArrowRight,
  Linkedin,
  Twitter,
  Instagram,
  Facebook,
  Youtube,
} from "lucide-react";

const LOGO = "/__mockup/images/sa-logo-horizontal-white.png";

// PRIMARY NAV — the decision path. "Book" is the endpoint, rendered as the
// emphasized CTA button rather than a plain link.
const PRIMARY_NAV = [
  { name: "Home", href: "#" },
  { name: "The Sprint", href: "#" },
  { name: "Proof", href: "#" },
  { name: "Fit", href: "#" },
];

// SECONDARY NAV — lighter-weight supporting links, top right.
const SECONDARY_NAV = [
  { name: "About", href: "#" },
  { name: "Method", href: "#" },
  { name: "Insights", href: "#" },
  { name: "Events", href: "#" },
];

export function Header({
  bookHref = "#",
  active,
}: {
  bookHref?: string;
  active?: string;
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${
        isScrolled
          ? "bg-background/80 backdrop-blur-md border-border/50 py-3"
          : "bg-transparent border-transparent py-5"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
        <a href="#" className="relative z-10 flex-shrink-0">
          <img src={LOGO} alt="The Synozur Alliance" className="h-7 md:h-9 w-auto" />
        </a>

        <div className="hidden lg:flex items-center gap-6">
          {/* Secondary nav — lighter weight */}
          <ul className="flex items-center gap-6 text-[13px] font-medium text-foreground/55">
            {SECONDARY_NAV.map((link) => (
              <li key={link.name}>
                <a
                  href={link.href}
                  className={`transition-colors hover:text-foreground/90 ${
                    active === link.name ? "text-foreground/90" : ""
                  }`}
                >
                  {link.name}
                </a>
              </li>
            ))}
          </ul>

          <span className="h-5 w-px bg-border/60" aria-hidden="true" />

          {/* Primary nav — the decision path */}
          <ul className="flex items-center gap-7 text-sm font-semibold text-foreground/85">
            {PRIMARY_NAV.map((link) => (
              <li key={link.name}>
                <a
                  href={link.href}
                  className={`transition-colors hover:text-foreground ${
                    active === link.name ? "text-primary" : ""
                  }`}
                >
                  {link.name}
                </a>
              </li>
            ))}
          </ul>

          <a
            href={bookHref}
            className={`h-10 px-6 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 ${
              active === "Book" ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""
            }`}
          >
            Book
          </a>
        </div>

        <button
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-nav"
          className="lg:hidden relative z-10 p-2 text-foreground/80 hover:text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <nav
          id="mobile-nav"
          className="lg:hidden border-t border-border/50 bg-background/95 backdrop-blur-md"
        >
          <div className="container mx-auto px-4 md:px-6 py-4">
            <ul className="flex flex-col gap-1 text-sm font-semibold text-foreground/85">
              {PRIMARY_NAV.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className={`block py-2 transition-colors hover:text-foreground ${
                      active === link.name ? "text-primary" : ""
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
            <ul className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-1 text-sm font-medium text-foreground/55">
              {SECONDARY_NAV.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="block py-2 transition-colors hover:text-foreground/90"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
            <a
              href={bookHref}
              className="mt-4 h-10 px-6 inline-flex w-full items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90"
              onClick={() => setMobileMenuOpen(false)}
            >
              Book
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}

const FOOTER_COLUMNS: { title: string; links: string[] }[] = [
  {
    title: "About",
    links: ["Our Story", "Team", "Partners", "Clients", "Careers", "Contact"],
  },
  {
    title: "Method",
    links: ["North Star Method", "All Applications", "Vega", "Orion", "Orbit", "Nebula"],
  },
  {
    title: "Solutions",
    links: [
      "AI Strategy & Design",
      "GTM Strategy & Execution",
      "Company OS",
      "Consulting Services",
    ],
  },
  {
    title: "Insights",
    links: ["Articles", "Whitepapers", "Podcast", "Events"],
  },
  {
    title: "Resources",
    links: [
      "Case Studies",
      "Webinars",
      "White Papers",
      "Workshops",
      "Models",
      "FAQ",
      "Browse Library",
    ],
  },
];

const SOCIAL: { label: string; Icon: typeof Linkedin }[] = [
  { label: "LinkedIn", Icon: Linkedin },
  { label: "Twitter", Icon: Twitter },
  { label: "Instagram", Icon: Instagram },
  { label: "Facebook", Icon: Facebook },
  { label: "YouTube", Icon: Youtube },
];

const LEGAL_LINKS = ["Trust & Security", "Privacy Policy", "Terms of Service"];

export function Footer() {
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
            <form
              className="flex gap-2 max-w-sm"
              aria-label="Subscribe to The Feed"
              onSubmit={(e) => e.preventDefault()}
            >
              <label htmlFor="footer-subscribe-email" className="sr-only">
                Email address
              </label>
              <input
                id="footer-subscribe-email"
                type="email"
                placeholder="Email address"
                className="flex-1 h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="submit"
                className="h-10 px-5 shrink-0 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
              >
                Subscribe
              </button>
            </form>
          </div>

          <div className="lg:text-right">
            <h3 className="font-semibold mb-4 text-foreground">Connect</h3>
            <div className="flex gap-4 mb-5 lg:justify-end">
              {SOCIAL.map(({ label, Icon }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  <Icon className="h-5 w-5" />
                </a>
              ))}
            </div>
            <a
              href="#"
              className="inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              Get Started <ArrowRight className="ml-1 h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 py-12">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="font-semibold mb-4 text-foreground">{col.title}</h3>
              <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
                {col.links.map((link) => (
                  <li key={link}>
                    <a href="#" className="hover:text-primary transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-border flex flex-col gap-6 text-sm text-muted-foreground">
          <address className="not-italic text-center md:text-left">
            13300 Bothell Everett Hwy, Suite 303, Mill Creek, WA 98012
          </address>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-center md:text-left">
              © 2026 The Synozur Alliance, LLC. All rights reserved. Synozur and The Synozur
              Alliance are trademarks of The Synozur Alliance, LLC.
            </p>
            <div className="flex gap-6 shrink-0">
              {LEGAL_LINKS.map((link) => (
                <a key={link} href="#" className="hover:text-foreground transition-colors">
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
