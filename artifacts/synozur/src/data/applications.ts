export type Application = {
  slug: string;
  name: string;
  tagline: string;
  version?: string;
  releaseDate: string;
  websiteUrl: string;
  isActive: boolean;
  logo: string;
  screenshot: string;
  shortSummary: string;
  description: string[];
  /**
   * "app"  = a standalone Synozur Suite application.
   * "part" = an add-in/web part designed to run INSIDE another product
   *          (e.g. the Holidays web part / Project Comet). Parts are published
   *          applications but are NOT suite members.
   */
  kind: "app" | "part";
  /**
   * Whether this product appears in the Synozur Suite app-switcher bar.
   * Parts (and anything catalog-only) MUST set this false — the switcher is
   * the "suite" surface, which is a strict subset of the published catalog.
   */
  inSuite: boolean;
  /**
   * Suite-surface presentation (app-switcher). Distinct from the marketing
   * `tagline`/`shortSummary` used on /applications: the switcher shows a
   * capability positioning line. Only meaningful when `inSuite` is true.
   */
  suite?: {
    /** Positioning line shown under the name in the switcher. */
    positioning: string;
    /** One-line capability description in the switcher tile. */
    description: string;
    /** Canonical app URL for the switcher (may differ from marketing site link). */
    url: string;
    /** Order within the switcher list. */
    order: number;
  };
};

export const applications: Application[] = [
  {
    slug: "vega",
    name: "Vega",
    tagline: "Put strategy to work, every day.",
    version: "1",
    releaseDate: "2026-01-06",
    websiteUrl: "https://vega.synozur.com",
    isActive: true,
    logo: "/images/applications/vega-logo.png",
    screenshot: "/images/applications/vega-screenshot.jpg",
    shortSummary:
      "Turns strategy into action every day — unifying mission, priorities, OKRs, and meetings into a single operating rhythm with seamless Microsoft 365 integration.",
    description: [
      "Vega is your AI-powered Company Operating System that turns strategy into action every day. It unifies mission, priorities, OKRs, and meetings into a single operating rhythm—bringing clarity, cadence, and accountability to your organization. With seamless Microsoft 365 integration, enterprise-grade security, and intelligent AI guidance that augments human judgment, Vega helps leaders align teams, track progress, and accelerate outcomes without the chaos of disconnected tools.",
    ],
    kind: "app",
    inSuite: true,
    suite: {
      positioning: "Company Operating System",
      description: "AI-augmented strategy, goals, execution, governance, and insight in one place.",
      url: "https://vega.synozur.com",
      order: 1,
    },
  },
  {
    slug: "nebula",
    name: "Nebula",
    tagline: "The birthplace of new starlight",
    version: "1",
    releaseDate: "2025-10-27",
    websiteUrl: "https://nebula.synozur.com",
    isActive: true,
    logo: "/images/applications/nebula-logo.jpg",
    screenshot: "/images/applications/nebula-screenshot.png",
    shortSummary:
      "Synozur's collaborative envisioning platform — built for facilitators who need to do more than just run a workshop.",
    description: [
      "Nebula is Synozur's collaborative envisioning platform — built for facilitators who need to do more than just run a workshop. Bring together teams, customers, or stakeholders in structured real-time sessions where ideas are surfaced, categorized by AI, and prioritized through voting, ranking, and visual frameworks like the 2×2 priority matrix. Whether you're shaping a product strategy, exploring transformation priorities, or building shared direction across an organization, Nebula turns group input into clear, AI-generated insights and personalized results that participants can act on long after the session ends.",
    ],
    kind: "app",
    inSuite: true,
    suite: {
      positioning: "Innovation & Envisioning",
      description: "Co-design strategy, surface insights, and turn ideas into shared direction.",
      url: "https://nebula.synozur.com",
      order: 4,
    },
  },
  {
    slug: "constellation",
    name: "Constellation",
    tagline: "Navigate Your Projects Like the Stars",
    releaseDate: "2025-09-01",
    websiteUrl: "https://scdp.synozur.com",
    isActive: true,
    logo: "/images/applications/constellation-logo.jpg",
    screenshot: "/images/applications/constellation-screenshot.png",
    shortSummary:
      "AI-powered Consulting Delivery Platform that improves execution quality, delivery confidence, and leadership decision-making across engagements.",
    description: [
      "Constellation is Synozur's AI-powered Consulting Delivery Platform, purpose-built for professional services organizations and designed to improve execution quality, delivery confidence, and leadership decision-making across engagements. By unifying project delivery, financials, and operational data inside the Microsoft 365 ecosystem, Constellation gives leaders a real-time, trustworthy view of status, deliverables, risks, issues, and costs—without relying on manual reporting or disconnected tools.",
      "AI capabilities built on Microsoft AI Foundry continuously synthesize live system data to generate clear status reports, highlight delivery risk, surface emerging issues, and produce executive-ready narratives and artifacts stored directly in SharePoint Embedded and accessible through Teams. Constellation tracks deliverables end-to-end, links work progress to financial performance, and makes accountability explicit—so teams spend less time assembling updates and more time addressing what matters. Tasks are synchronized to Outlook and Planner, and Constellation's AI agent integrates directly into M365 Copilot for ease of use.",
      "With deep Microsoft alignment, CRM integration, and Copilot-ready data access, Constellation turns delivery operations into a predictable, transparent system that helps organizations stay on track, manage risk proactively, and keep execution aligned to strategy as work unfolds.",
    ],
    kind: "app",
    inSuite: true,
    suite: {
      positioning: "Delivery & Financial Management",
      description: "Time, cost, progress tracking with estimates, invoicing, and reporting.",
      url: "https://constellation.synozur.com",
      order: 3,
    },
  },
  {
    slug: "orion",
    name: "Orion",
    tagline: "Chart your course with confidence.",
    version: "1",
    releaseDate: "2025-11-03",
    websiteUrl: "https://models.synozur.com",
    isActive: true,
    logo: "/images/applications/orion-logo.jpg",
    screenshot: "/images/applications/orion-screenshot.jpg",
    shortSummary:
      "AI-powered transformation platform that applies Synozur's frameworks, research, and advisory experience at scale.",
    description: [
      "Transformation is hard.",
      "Most organizations know their ambitions, but the journey from today's reality to tomorrow's outcomes is complex, uncertain, and often overwhelming. Orion is built to bridge that gap — giving you clarity, confidence, and a path forward that's tailored to your unique context. Measurement and benchmarking are crucial.",
      "Orion is Synozur's AI-powered transformation platform that applies our deep expertise—frameworks, research, and real-world advisory experience—at scale. Rather than delivering generic assessments, Orion integrates AI to interpret your organization's unique context, synthesizing your data with Synozur's proven models to produce personalized results you can trust.",
      "It translates insight into a tailored view of your current state, then delivers role-specific recommendations, prioritized actions, and curated resources aligned to your industry, maturity, and goals. By combining human expertise with AI-driven analysis, Orion moves organizations beyond static reports—providing clear guidance, practical next steps, and the confidence to act with clarity as transformation unfolds.",
    ],
    kind: "app",
    inSuite: true,
    suite: {
      positioning: "Transformation & Maturity",
      description: "AI-powered maturity assessments with actionable roadmaps for change.",
      url: "https://orion.synozur.com",
      order: 5,
    },
  },
  {
    slug: "orbit",
    name: "Orbit",
    tagline: "Market Intelligence That Never Sleeps",
    version: "0.5",
    releaseDate: "2026-01-21",
    websiteUrl: "https://orbit.synozur.com",
    isActive: true,
    logo: "/images/applications/orbit-logo.jpg",
    screenshot: "/images/applications/orbit-screenshot.jpg",
    shortSummary:
      "Go-to-market intelligence platform that turns competitive insight into ready-to-use execution assets.",
    description: [
      "Orbit is Synozur's go-to-market intelligence platform that turns competitive insight into ready-to-use execution assets. Orbit continuously monitors market signals, competitor positioning, news, and messaging shifts—then automatically generates and refreshes GTM outputs such as Messaging & Positioning Frameworks (MPFs), one-sheet sell sheets, and sales battlecards aligned to what's happening in the market right now. Instead of static research or outdated decks, Orbit gives teams a living GTM system—combining ongoing competitive intelligence with auto-generated, execution-ready materials that help marketing, product, and sales adapt faster, sharpen differentiation, and win with confidence.",
    ],
    kind: "app",
    inSuite: true,
    suite: {
      positioning: "Go-to-Market Intelligence",
      description: "Competitive and market insights for positioning, prioritization, and action.",
      url: "https://orbit.synozur.com",
      order: 7,
    },
  },
  {
    slug: "zenith",
    name: "Zenith",
    tagline: "Enterprise Governance for Microsoft 365",
    version: "0.9",
    releaseDate: "2026-03-01",
    websiteUrl: "https://zenith.synozur.com",
    isActive: true,
    logo: "/images/applications/zenith-logo.jpg",
    screenshot: "/images/applications/zenith-screenshot.png",
    shortSummary:
      "Centralized governance control plane for Microsoft 365 — built for IT leaders, governance teams, and managed service providers.",
    description: [
      "Zenith is Synozur's centralized governance control plane for Microsoft 365, built for IT leaders, governance teams, and managed service providers operating complex, multi-tenant environments. It unifies workspace visibility, automated policy evaluation, sensitivity and retention alignment, and Copilot readiness tracking into a single, secure system—eliminating reliance on scripts, manual audits, and fragmented tools.",
      "Zenith integrates with Microsoft Entra ID for tenant-isolated identity, multi-factor authentication, and granular role-based access control, ensuring the right users have the right visibility at the right time. Governance decisions are written directly back into SharePoint so Microsoft Purview can enforce policies natively, creating a closed loop between governance intent and day-to-day operations.",
      "Hosted in SOC 2 Type II–certified data centers and designed for enterprise-grade security and auditability, Zenith helps organizations govern at scale, reduce risk, and confidently prepare their Microsoft 365 environments for Copilot and future AI adoption.",
    ],
    kind: "app",
    inSuite: true,
    suite: {
      positioning: "M365 AI Content Governance",
      description: "AI-powered content governance, compliance, and lifecycle management for Microsoft 365.",
      url: "https://zenith.synozur.com",
      order: 6,
    },
  },
  {
    slug: "holidays-and-birthdays-web-part",
    name: "Holidays and Birthdays Web Part",
    tagline: "People-centric engagement for your intranet",
    version: "2.1",
    releaseDate: "2026-03-16",
    websiteUrl: "https://aka.synozur.com/holidayswp",
    isActive: true,
    logo: "/images/applications/holidays-logo.jpg",
    screenshot: "/images/applications/holidays-screenshot.png",
    shortSummary:
      "Project Comet brings holidays and birthdays into everyday view across SharePoint and Viva Connections — our gift back to the SharePoint community.",
    description: [
      "Project Comet is a small but meaningful way to make work more human. It brings holidays and birthdays into everyday view across SharePoint and Viva Connections—helping organizations pause, rest, and celebrate the people who make the work possible. Designed to deploy in minutes and managed entirely through standard SharePoint lists and permissions, Project Comet removes friction for administrators while creating moments of recognition and connection for employees. Built as an open, community-first solution and shared freely with no licensing or paywalls, Project Comet is our gift back to the SharePoint community—a reminder that great digital workplaces don't just help us work better, they help us care for one another too.",
      "The link takes you to the download page on GitHub for the compiled SPPKG file.",
    ],
    // A published "part" (SharePoint web part), NOT a suite application. It is
    // installed inside SharePoint/Viva, so it never appears in the app-switcher
    // bar. Future installable parts should follow this same shape.
    kind: "part",
    inSuite: false,
  },
];

export function getApplicationBySlug(slug: string): Application | undefined {
  return applications.find((a) => a.slug === slug);
}

export function getActiveApplications(): Application[] {
  return applications.filter((a) => a.isActive);
}

/**
 * The catalog products that also belong in the Synozur Suite app-switcher bar,
 * ordered. Catalog and suite OVERLAP but neither contains the other:
 *   - catalog-only: installable "parts" such as Comet (inSuite: false)
 *   - suite-only:   platform entries — the Synozur website and the Galaxy
 *                   portal — which aren't products, so they live in the
 *                   app-switcher's own PLATFORM_APPS list, not here.
 * The app-switcher composes its bar from PLATFORM_APPS + this list, so the six
 * shared products can never drift apart on names, URLs, or positioning.
 */
export type SuiteEntry = {
  slug: string;
  name: string;
  positioning: string;
  description: string;
  url: string;
  order: number;
};

export function getSuiteApplications(): SuiteEntry[] {
  return applications
    .filter((a) => a.isActive && a.inSuite && a.suite)
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      positioning: a.suite!.positioning,
      description: a.suite!.description,
      url: a.suite!.url,
      order: a.suite!.order,
    }))
    .sort((x, y) => x.order - y.order);
}
