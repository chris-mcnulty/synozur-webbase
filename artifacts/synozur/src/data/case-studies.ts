export type CaseStudyMetric = {
  label: string;
  value: string;
};

export type CaseStudyBlock = {
  heading: string;
  body: string[];
  bullets?: string[];
};

export type CaseStudy = {
  slug: string;
  title: string;
  client: string;
  clientLabel: string;
  industry: string;
  established?: string;
  tag: string;
  summary: string;
  heroImage: string;
  challenge: CaseStudyBlock;
  approach: CaseStudyBlock[];
  outcome: CaseStudyBlock;
  metrics: CaseStudyMetric[];
  quote: {
    text: string;
    attribution: string;
  };
  headline: string;
};

export const caseStudies: CaseStudy[] = [
  {
    slug: "transforming-management-frameworks-at-microsoft",
    title: "Transforming management frameworks at Microsoft",
    client: "Microsoft",
    clientLabel: "Microsoft",
    industry: "Technology",
    established: "1975",
    tag: "Strategy",
    headline: "$0.5M–$1.0M annual productivity cost avoidance",
    summary:
      "Reinvented the annual planning offsite for a Microsoft Modern Work product marketing group — installing OKRs, an operating cadence, and a working management framework that became the team's playbook for the year.",
    heroImage: "/images/case-study-microsoft.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "Microsoft's Modern Work organization, part of its Cloud Marketing division, runs a Product Marketing Group focused on the Microsoft 365 portfolio. Despite strong product results, the team lacked a coherent management framework for planning, goal attainment, impact, and team cohesion.",
        "The PMG leader needed to create a new team culture and establish connected goals and OKRs to ensure success. With recent expansion of the team, the upcoming multi-day offsite had to deliver high-impact planning — and avoid the dreaded \"BOPSAT\" (Bunch Of People Sit Around Talking).",
      ],
    },
    approach: [
      {
        heading: "1. Assessment & analysis",
        body: [
          "Synozur began with an in-depth assessment of the PMG team's existing management framework.",
        ],
        bullets: [
          "Pre-interviews with key stakeholders to surface pain points and aspirations.",
          "Analysis of current workflows, communication patterns, and decision-making.",
          "Identification of gaps and the highest-leverage areas to address at the offsite.",
        ],
      },
      {
        heading: "2. Strategic framework development",
        body: [
          "Synozur and Microsoft co-developed the offsite agenda and a plan for establishing a new OKR framework tailored to the unique needs of the PMG.",
        ],
        bullets: [
          "Clear roles and responsibilities to eliminate ambiguity.",
          "Agile methodologies to enhance flexibility and responsiveness.",
          "Adjusted weekly and monthly meetings and feedback loops.",
          "OKRs to measure progress and drive accountability.",
        ],
      },
      {
        heading: "3. Implementation & training offsite",
        body: [
          "The offsite opened with a workshop using a data-driven behavioral methodology, helping the team uncover working styles and improve collaboration.",
          "Synozur then introduced the team to OKRs through focused training. Many members had never previously owned personal measurable goals. Using design-led thinking, Synozur facilitated exercises to capture, prioritize, and establish a hierarchy of OKRs with measurable, SMART results — and helped the team produce its first quarterly project list as a single-slide view.",
        ],
      },
      {
        heading: "4. Operationalize",
        body: [
          "Agreeing on goals is one thing; operationalizing them is another. Synozur provided individual and group coaching on creating OKRs in Viva Goals, established new rhythms for weekly check-ins and monthly goal reviews, and supported the team for several months post-offsite — including 1:1 coaching where it was needed most.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "The new framework created higher achievement against goals (including >100% revenue growth on key OKRs), broke down silos across functions, and accelerated decision-making and product marketing execution.",
      ],
      bullets: [
        "Higher achievement: OKRs were reviewed and adjusted in cadence — issues were caught earlier, and the team consistently met or exceeded targets.",
        "Enhanced collaboration: cross-functional silos broke down; a winning team identity emerged.",
        "Improved efficiency: agile methodologies and streamlined processes accelerated marketing decisions.",
      ],
    },
    metrics: [
      { label: "Annual productivity cost avoidance", value: "$0.5M–$1.0M" },
      { label: "Revenue influence (multi-million)", value: "$M+" },
      { label: "OKR revenue growth on key goals", value: ">100%" },
    ],
    quote: {
      text: "The team finally had a shared way to plan, measure, and adjust together — instead of reinventing the playbook every quarter.",
      attribution: "Product Marketing Group leader, Microsoft Modern Work",
    },
  },
  {
    slug: "management-makeover-at-a-luxury-brand",
    title: "Management Makeover at a Luxury Brand",
    client: "North American Luxury Manufacturer",
    clientLabel: "Luxury Manufacturing",
    industry: "Cosmeceutical",
    established: "2002",
    tag: "Strategy",
    headline: "$0.6M–$1.3M cost savings, $0.5M–$1.5M+ revenue enablement",
    summary:
      "A founder-led North American luxury skincare manufacturer had outgrown its original operating rhythm. Synozur installed a Company Operating System that scaled with the business — and rebuilt the leadership bench to run it.",
    heroImage: "/images/case-study-luxury.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "A prominent North American luxury manufacturer engaged Synozur for a digital transformation initiative. Renowned for its innovative skincare products, the company had grown significantly — beyond its existing management framework and the time constraints of its founders.",
        "As the company scaled, the operating system had to evolve to support further growth, expansion, and a broader leadership team.",
      ],
    },
    approach: [
      {
        heading: "Discovery",
        body: [
          "Synozur was originally engaged on a digital transformation project. In conversations with the founders it became clear that a broader set of tools and processes were needed to move the business from a conversational approach to a structured, intentional operating model.",
        ],
      },
      {
        heading: "Develop the Company OS",
        body: [
          "Synozur introduced a Company Operating System (CoS) tailored to the client. It is built to create and maintain focus on business priorities, align people, resources, and plans, and provide a clear vision, mission, purpose, and strategy.",
        ],
        bullets: [
          "Annual plan: yearly objectives and quarterly \"rocks\" (incremental goals).",
          "Weekly meeting rhythm: focus meetings to review priorities, analyze metrics, and solve issues collaboratively.",
          "Foundational workshops on mission, value, and purpose — reinforced through ongoing drip campaigns.",
        ],
      },
      {
        heading: "Deploy and hand off",
        body: [
          "Synozur led weekly focus meetings for several weeks, participating actively before transitioning the leadership team to run them independently. The agenda included joint problem-solving and scorecard analysis — fostering a collaborative, data-driven approach.",
          "Synozur also prepared the leadership with a custom Company Operating System Manual (COSM) so anyone — not just the founders — could run effective focus meetings.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "The new meeting structure and focus on priorities led to better decisions, sharper operations, and stronger team dynamics. The leadership team now has a unified \"sheet of music\" and greater visibility into what drives the company's performance — putting them on an optimized path to executing growth strategies including plant modernization and new product line launches.",
      ],
      bullets: [
        "Weekly focus meetings replaced less effective recurring meetings.",
        "A company scorecard gave leaders a shared view of performance — and let junior leaders interpret the metrics on their own.",
        "Reorganized leadership team with new roles: Chief People Officer, VP Operations, CFO, and CRO.",
      ],
    },
    metrics: [
      { label: "Annual cost savings", value: "$0.6M–$1.3M" },
      { label: "Revenue enablement", value: "$0.5M–$1.5M+" },
      { label: "Leadership roles added", value: "4 new C-level" },
    ],
    quote: {
      text: "Our journey with the Company Operating System has truly transformed the way we operate and lead. The clear focus on priorities and performance metrics have empowered us to make strategic decisions more effectively. We are now aligned and equipped to drive sustainable growth and excellence in our industry.",
      attribution: "Senior leader, North American luxury manufacturer",
    },
  },
  {
    slug: "energy-company-reinvents-employee-expereince-and-effectiveness",
    title: "Energy company reinvents employee experience and effectiveness",
    client: "North American Energy Company",
    clientLabel: "North American Energy Company",
    industry: "Energy",
    established: "1920",
    tag: "Employee Effectiveness",
    headline: "$2.0M–$6.0M annual productivity gains across 12,000+ employees",
    summary:
      "A North American energy company facing engagement and communication problems across a 12,000+ employee workforce engaged Synozur to rebuild its employee experience — anchored in journey mapping, personalization, and a Minimum Lovable Product approach.",
    heroImage: "/images/case-study-energy.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "A North American energy company faced significant challenges with employee engagement and communication for its 12,000+ employees. Internal research and surveys highlighted a clear need for improved engagement and communication tools — and revealed widespread dissatisfaction with the existing intranet.",
      ],
      bullets: [
        "The existing intranet was outdated and not user-friendly.",
        "Employees were dissatisfied with engagement and communication tools.",
        "Productivity, collaboration, and overall employee satisfaction were substandard.",
      ],
    },
    approach: [
      {
        heading: "Experience principles",
        body: ["Synozur developed a small set of experience principles to anchor every decision in the program."],
        bullets: [
          "Personalized and relevant tools and information.",
          "Quick access to the actions and tools people use most.",
          "Better integration with existing tools rather than duplicating functionality.",
        ],
      },
      {
        heading: "Workshops, personas, and a Minimum Lovable Product",
        body: [
          "Synozur ran a workshop-centered program to develop user insights, requirements, and personas — tailoring the intranet design to different user groups across the workforce.",
          "Rather than a Minimum Viable Product, the team adopted a Minimum Lovable Product (MLP) approach to ensure the platform was both functional and genuinely engaging.",
        ],
      },
      {
        heading: "Vision and roadmap",
        body: [
          "The vision and roadmap centered on creating a personalized, efficient, and engaging experience for employees, with key scenarios driving decisions about content and functionality access.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "Synozur's design elevated employee experience on the intranet and set the foundation for future employee-centered initiatives — aligning business goals with a cohesive, dynamic digital workspace.",
      ],
      bullets: [
        "Capabilities organized into five clear themes: Search and Find, People and Profiles, News and Events, Community, and Navigation.",
        "Site disposition strategy based on the primary purpose and audience — leveraging different publishing tools for different content types.",
        "Personalized search delivering security-trimmed results, with filtering by source, type, function, or segment.",
      ],
    },
    metrics: [
      { label: "Annual productivity gains", value: "$2.0M–$6.0M" },
      { label: "Workforce reached", value: "12,000+ employees" },
      { label: "Experience themes", value: "5 unified" },
    ],
    quote: {
      text: "Synozur's impact through this project has truly revolutionized how our employees interact and collaborate, positioning us for greater innovation and success.",
      attribution: "Vice President of Digital Collaboration",
    },
  },
];

export function getCaseStudyBySlug(slug: string): CaseStudy | undefined {
  return caseStudies.find((cs) => cs.slug === slug);
}
