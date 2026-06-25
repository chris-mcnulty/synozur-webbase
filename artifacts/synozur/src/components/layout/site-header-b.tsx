import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const LOGO = `${BASE_PATH}/images/sa-logo-horizontal-white.png`;

// PRIMARY NAV — the decision path. "Book" is the endpoint, rendered as the
// emphasized CTA button rather than a plain link.
const PRIMARY_NAV = [
  { name: "Home", href: "/home-b" },
  { name: "The Sprint", href: "/sprint" },
  { name: "Proof", href: "/proof" },
  { name: "Fit", href: "/fit" },
];

// SECONDARY NAV — lighter-weight supporting links, top right.
const SECONDARY_NAV = [
  { name: "About", href: "/about" },
  { name: "Method", href: "/services-overview/default" },
  { name: "Insights", href: "/insights" },
  { name: "Events", href: "/events" },
];

const BOOK_HREF = "/book";

export function SiteHeaderB() {
  const [location] = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const isActive = (href: string) => location === href;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${
        isScrolled
          ? "bg-background/80 backdrop-blur-md border-border/50 py-3"
          : "bg-transparent border-transparent py-5"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
        <Link href="/home-b" className="relative z-10 flex-shrink-0">
          <img src={LOGO} alt="The Synozur Alliance" className="h-7 md:h-9 w-auto" />
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          {/* Secondary nav — lighter weight */}
          <ul className="flex items-center gap-6 text-[13px] font-medium text-foreground/55">
            {SECONDARY_NAV.map((link) => (
              <li key={link.name}>
                <Link
                  href={link.href}
                  className={`transition-colors hover:text-foreground/90 ${
                    isActive(link.href) ? "text-foreground/90" : ""
                  }`}
                >
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>

          <span className="h-5 w-px bg-border/60" aria-hidden="true" />

          {/* Primary nav — the decision path */}
          <ul className="flex items-center gap-7 text-sm font-semibold text-foreground/85">
            {PRIMARY_NAV.map((link) => (
              <li key={link.name}>
                <Link
                  href={link.href}
                  className={`transition-colors hover:text-foreground ${
                    isActive(link.href) ? "text-primary" : ""
                  }`}
                >
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href={BOOK_HREF}
            className={`h-10 px-6 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 ${
              isActive(BOOK_HREF) ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""
            }`}
          >
            Book
          </Link>
        </div>

        <button
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-nav-b"
          className="lg:hidden relative z-10 p-2 text-foreground/80 hover:text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <nav
          id="mobile-nav-b"
          className="lg:hidden border-t border-border/50 bg-background/95 backdrop-blur-md"
        >
          <div className="container mx-auto px-4 md:px-6 py-4">
            <ul className="flex flex-col gap-1 text-sm font-semibold text-foreground/85">
              {PRIMARY_NAV.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className={`block py-2 transition-colors hover:text-foreground ${
                      isActive(link.href) ? "text-primary" : ""
                    }`}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-1 text-sm font-medium text-foreground/55">
              {SECONDARY_NAV.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="block py-2 transition-colors hover:text-foreground/90"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={BOOK_HREF}
              className="mt-4 h-10 px-6 inline-flex w-full items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90"
            >
              Book
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
