import { Linkedin, Twitter, Youtube, type LucideIcon } from "lucide-react";

export const LOGO_COLOR_URL =
  "https://static.wixstatic.com/media/b805ce_7a5d9f47e6df42c6a2dab307ce8c4cf3~mv2.png/v1/fill/w_231,h_63,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/SA-Logo-Horizontal-color.png";

export type NavLink = { label: string; href: string };
export type NestedSection = {
  sectionTitle?: string;
  label: string;
  href: string;
  children: NavLink[];
};
export type NavGroup = {
  title: string;
  links: NavLink[];
  nested?: NestedSection[];
};
export type NavService = {
  title: string;
  slug: string;
  solutions: { title: string; slug: string }[];
};
export type NavApplication = { slug: string; name: string };

export const STATIC_SERVICE_PILLARS: NavService[] = [
  {
    title: "Organizational Transformation",
    slug: "strategic-transformation",
    solutions: [
      { title: "Company OS", slug: "company-os" },
      { title: "Fractional Leadership", slug: "fractional-leadership" },
      { title: "Delivery Management", slug: "delivery-management" },
    ],
  },
  {
    title: "Technology Transformation",
    slug: "technology-transformation",
    solutions: [
      { title: "Strategic Roadmaps", slug: "strategic-roadmaps" },
      { title: "AI Strategy and Design", slug: "ai-strategy-and-design" },
      { title: "Employee Effectiveness", slug: "employee-effectiveness" },
      { title: "Microsoft 365 Adoption, Strategy & Optimization", slug: "microsoft-365-optimization" },
    ],
  },
  {
    title: "Experience Transformation",
    slug: "experiences",
    solutions: [
      { title: "Employee Strategies", slug: "employee-strategies" },
      { title: "Communication Strategies", slug: "communication-strategies" },
      { title: "Design Strategies", slug: "design-strategies" },
    ],
  },
  {
    title: "Go-To-Market Transformation",
    slug: "go-to-market-transformation",
    solutions: [
      { title: "Brand and Messaging", slug: "brand-and-messaging" },
      { title: "GTM Strategy and Execution", slug: "gtm-strategy-and-execution" },
      { title: "Microsoft Partner Development", slug: "microsoft-partner-development" },
    ],
  },
  {
    title: "Our Services",
    slug: "our-services",
    solutions: [],
  },
];

export const STATIC_APPLICATIONS: NavApplication[] = [
  { slug: "vega", name: "Vega" },
  { slug: "nebula", name: "Nebula" },
  { slug: "constellation", name: "Constellation" },
  { slug: "orion", name: "Orion" },
  { slug: "orbit", name: "Orbit" },
  { slug: "zenith", name: "Zenith" },
  { slug: "holidays-and-birthdays-web-part", name: "Holidays and Birthdays Web Part" },
];

export const SAME_AS_FALLBACK: readonly string[] = [
  "https://www.linkedin.com/company/synozur",
];

export type SocialLink = { href: string; label: string; Icon: LucideIcon };

const matchesDomain = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

const SOCIAL_MATCHERS: {
  test: (host: string) => boolean;
  label: string;
  Icon: LucideIcon;
}[] = [
  { test: (h) => matchesDomain(h, "linkedin.com"), label: "LinkedIn", Icon: Linkedin },
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

export function pickSocialLinks(
  sameAs: readonly string[] | null | undefined,
): SocialLink[] {
  const source = sameAs && sameAs.length > 0 ? sameAs : SAME_AS_FALLBACK;
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
    for (const m of SOCIAL_MATCHERS) {
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

export const STATIC_NAV_GROUPS_BASE = {
  ourStory: {
    title: "Our Story",
    links: [
      { label: "About", href: "/about" },
      { label: "Team", href: "/team" },
      { label: "Clients", href: "/clients" },
      { label: "Partners", href: "/partners" },
      { label: "Careers", href: "/careers" },
    ],
  },
  theFeed: {
    title: "The Feed",
    links: [
      { label: "Insights Blog", href: "/insights" },
      { label: "Polaris Podcast", href: "/polaris" },
      { label: "Events", href: "/events" },
    ],
  },
  resources: {
    title: "Resources",
    links: [
      { label: "Case Studies", href: "/case-studies" },
      { label: "Webinars", href: "/webinars" },
      { label: "White Papers", href: "/white-papers" },
      { label: "Workshops", href: "/workshops" },
      { label: "Models", href: "/models" },
      { label: "FAQ", href: "/faq" },
      { label: "Browse Library", href: "/library" },
    ],
  },
} as const satisfies Record<string, { title: string; links: NavLink[] }>;

export function buildServicesGroup(pillars: NavService[]): NavGroup {
  return {
    title: "Services",
    links: [{ label: "Services Overview", href: "/services-overview/default" }],
    nested: pillars.map((p) => ({
      label: p.title,
      href: `/services/${p.slug}`,
      children: p.solutions.map((s) => ({ label: s.title, href: `/solutions/${s.slug}` })),
    })),
  };
}

export function buildApplicationsNestedSection(
  apps: NavApplication[],
): NestedSection {
  return {
    sectionTitle: "Applications",
    label: "All Applications",
    href: "/applications",
    children: apps.map((a) => ({ label: a.name, href: `/applications/${a.slug}` })),
  };
}

export const FOOTER_STATIC_SERVICES = [
  { slug: "strategic-transformation", title: "Strategic Transformation" },
  { slug: "technology-transformation", title: "Technology Transformation" },
  { slug: "experiences", title: "Experiences" },
  { slug: "go-to-market-transformation", title: "Go-to-Market Transformation" },
] as const;

export const FOOTER_STATIC_APPLICATIONS = [
  { slug: "vega", name: "Vega" },
  { slug: "orion", name: "Orion" },
  { slug: "orbit", name: "Orbit" },
] as const;

export const FOOTER_COMPANY_LINKS: NavLink[] = [
  { label: "Our Story", href: "/about" },
  { label: "Leadership", href: "/team" },
  { label: "Partners", href: "/partners" },
  { label: "Clients", href: "/clients" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
];

export const FOOTER_LEGAL_LINKS: NavLink[] = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

export const ORG_ADDRESS = "13300 Bothell Everett Hwy, Suite 303, Mill Creek, WA 98012";

export const ORG_COPYRIGHT_NAME =
  "The Synozur Alliance, LLC. All rights reserved. Synozur and The Synozur Alliance are trademarks of The Synozur Alliance, LLC.";
