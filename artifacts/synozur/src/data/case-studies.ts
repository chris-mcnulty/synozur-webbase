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
  {
    slug: "scaling-copilot-adoption-at-a-global-bank",
    title: "Scaling Copilot adoption at a global bank",
    client: "Global Financial Services Firm",
    clientLabel: "Global Bank (NDA)",
    industry: "Financial Services",
    established: "1869",
    tag: "AI Adoption",
    headline: "11x ROI on Copilot licenses within two quarters",
    summary:
      "A top-ten global bank had purchased Microsoft 365 Copilot at scale but adoption was stalled at under 20%. Synozur built the change program, measurement model, and use-case catalog that turned a stalled rollout into a measurable productivity win across 18,000 knowledge workers.",
    heroImage: "/images/case-study-financial-ai.png",
    challenge: {
      heading: "The challenge",
      body: [
        "The bank had pre-purchased tens of thousands of Copilot licenses ahead of a board-level commitment to AI productivity. Six months in, weekly active use sat below 20%, value stories were anecdotal, and risk and compliance teams had quietly paused expansion to several business units.",
        "The CIO needed a defensible adoption plan, a way to measure dollars-and-hours impact, and a path through the firm's model-risk and data-handling controls — without slowing the business units that were already seeing wins.",
      ],
      bullets: [
        "Licenses deployed but largely unused — finance was beginning to question the spend.",
        "No shared definition of \"good\" adoption beyond raw login counts.",
        "Risk, legal, and HR each had separate, conflicting guidance for employees.",
      ],
    },
    approach: [
      {
        heading: "1. Diagnose the real blockers",
        body: [
          "Synozur ran a two-week diagnostic combining Microsoft 365 usage telemetry, structured interviews with 40 users across six business units, and a review of the existing governance posture.",
        ],
        bullets: [
          "Mapped where Copilot was actually creating value vs. where it was being abandoned after one or two tries.",
          "Surfaced the top five frictions — prompt literacy, data sensitivity confusion, app fragmentation, manager skepticism, and time-to-first-win.",
          "Quantified a baseline of hours-per-week spent on the tasks Copilot was best positioned to absorb.",
        ],
      },
      {
        heading: "2. Build a use-case catalog by role",
        body: [
          "Rather than horizontal training, Synozur co-designed a catalog of 60+ role-specific use cases — relationship managers, credit analysts, operations leads, internal audit, and HR business partners each got a curated set with prompts, sample inputs, and expected outputs.",
        ],
        bullets: [
          "Each use case shipped with a time-saved estimate and a risk classification.",
          "\"Lighthouse\" use cases were piloted with named teams for two-week sprints.",
          "Wins were captured as short video clips and circulated weekly inside each business unit.",
        ],
      },
      {
        heading: "3. Reset governance with one front door",
        body: [
          "Synozur facilitated a cross-functional working group with risk, legal, HR, and security to consolidate guidance into a single, plain-language playbook — and a single intake for new use cases that previously bounced between three teams for weeks.",
        ],
      },
      {
        heading: "4. Measure in dollars, not logins",
        body: [
          "Synozur built a value model that converted telemetry, time-saved estimates, and a quarterly user survey into a single dashboard the CIO could share with the board. The model was deliberately conservative — finance signed off on the methodology before the first reporting cycle.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "Within two quarters, weekly active Copilot use crossed 70% in the targeted business units, and the value model passed independent review by the bank's internal audit function. The board-level AI productivity commitment moved from \"at risk\" to \"on track,\" and the program was extended to an additional 22,000 employees.",
      ],
      bullets: [
        "Single governance playbook replaced six conflicting documents.",
        "60+ role-specific use cases with measurable time-saved estimates.",
        "Audit-reviewed value model adopted as the firm-wide standard for AI productivity reporting.",
      ],
    },
    metrics: [
      { label: "ROI on Copilot licenses (two quarters)", value: "11x" },
      { label: "Weekly active use, target units", value: "<20% → 70%+" },
      { label: "Knowledge workers in scope", value: "18,000" },
    ],
    quote: {
      text: "Synozur turned a stalled rollout into something the board could actually point to. The value model is what made the difference — once finance trusted the number, every other conversation got easier.",
      attribution: "Chief Information Officer, Global Financial Services Firm",
    },
  },
  {
    slug: "modernizing-clinical-collaboration-at-a-health-system",
    title: "Modernizing clinical collaboration at a health system",
    client: "Regional U.S. Health System",
    clientLabel: "U.S. Health System (NDA)",
    industry: "Healthcare",
    established: "1947",
    tag: "Digital Transformation",
    headline: "42 minutes saved per clinician per shift",
    summary:
      "A multi-hospital U.S. health system was drowning in pagers, group texts, and three competing collaboration tools. Synozur led the strategy, governance, and clinician-led design that consolidated communication onto a single secure platform — and gave time back to the people at the bedside.",
    heroImage: "/images/case-study-healthcare.png",
    challenge: {
      heading: "The challenge",
      body: [
        "A regional health system with 11 hospitals and more than 6,000 clinicians had accumulated three overlapping clinical collaboration tools, an aging paging system, and a long tail of unsanctioned consumer messaging apps used at the bedside. Care teams routinely re-entered the same information in three places, and the CMIO had open complaints about message fatigue and missed handoffs.",
        "An attempt to standardize a year earlier had failed when clinicians rejected the chosen tool as \"built for office workers, not for us.\"",
      ],
    },
    approach: [
      {
        heading: "Clinician-led discovery",
        body: [
          "Synozur ran shadow shifts with nurses, hospitalists, and care coordinators across three hospitals — capturing every interruption, every tool switch, and every workaround. The output was a single map of the clinical day that became the reference point for every later decision.",
        ],
      },
      {
        heading: "A platform decision the clinicians owned",
        body: [
          "Rather than running a traditional vendor bake-off in IT, Synozur facilitated a clinician selection panel against a weighted scorecard the panel itself authored. The same panel set the rules for what would and would not move to the new platform.",
        ],
        bullets: [
          "Weighted scorecard owned by clinicians, scored in the open.",
          "Explicit list of workflows that would stay on existing systems — and why.",
          "A 90-day \"no new tools\" commitment from IT to rebuild trust.",
        ],
      },
      {
        heading: "Governance, identity, and the on-call problem",
        body: [
          "Synozur designed the governance model — naming conventions, lifecycle, on-call routing, and the integration with the EHR's secure messaging — and worked with the identity team to make role-based on-call lookup work the same way at every hospital.",
        ],
      },
      {
        heading: "Rollout by service line, not by hospital",
        body: [
          "Deployment moved service line by service line, with a peer champion in each unit, a two-week hyper-care window, and a weekly retro that fed directly into the governance backlog. The pager system was retired only after each service line confirmed it was ready.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "Within nine months, the health system had retired one redundant collaboration platform, sunset its pager contract at eight of eleven hospitals, and reduced the number of tools clinicians touched in a typical shift from five to two.",
      ],
      bullets: [
        "Clinician-reported time savings averaged 42 minutes per shift, validated by a follow-up time study.",
        "Critical-result acknowledgement times improved by 31%.",
        "Unsanctioned consumer messaging at the bedside dropped to near zero in audited units.",
      ],
    },
    metrics: [
      { label: "Time saved per clinician per shift", value: "42 minutes" },
      { label: "Tools touched per shift", value: "5 → 2" },
      { label: "Critical-result acknowledgement", value: "+31% faster" },
    ],
    quote: {
      text: "The previous attempt failed because IT picked the tool. This time the clinicians picked it, the governance was theirs, and the rollout respected the realities of a shift. That is the entire difference.",
      attribution: "Chief Medical Information Officer, Regional Health System",
    },
  },
  {
    slug: "knowledge-graph-for-a-global-research-university",
    title: "A knowledge graph for a global research university",
    client: "Global Research University",
    clientLabel: "Research University (NDA)",
    industry: "Higher Education",
    established: "1851",
    tag: "Knowledge & Search",
    headline: "60% reduction in time-to-find for grant and expertise data",
    summary:
      "A globally ranked research university could not reliably answer the question \"who at this institution works on X?\" Synozur designed and shipped an expertise and grants knowledge graph that became the connective tissue across the research office, advancement, and the provost.",
    heroImage: "/images/case-study-higher-ed.png",
    challenge: {
      heading: "The challenge",
      body: [
        "A top-50 global research university had grown its research portfolio to more than $900M annually, spread across nine schools, dozens of institutes, and hundreds of centers. Faculty expertise, active grants, publications, and student affiliations lived in at least seven systems of record — none of which fully agreed.",
        "When industry partners or foundation officers asked who could lead a multi-disciplinary proposal, the answer often took weeks of email — and the university repeatedly lost competitive opportunities to peer institutions that could answer in a day.",
      ],
    },
    approach: [
      {
        heading: "Define the graph, not the project",
        body: [
          "Synozur worked with the VP for Research, the CIO, and a faculty advisory group to agree on a small, durable schema — people, expertise, grants, publications, units, and partnerships — before any system was touched. The schema was deliberately narrower than what some stakeholders wanted, so it could actually ship.",
        ],
      },
      {
        heading: "Source-of-truth treaties",
        body: [
          "Each entity got a single owning system and a written \"treaty\" describing what could and could not be edited downstream. Synozur facilitated the negotiations and documented the trade-offs so they did not have to be re-litigated every quarter.",
        ],
        bullets: [
          "HR system as source of truth for appointments and titles.",
          "Sponsored programs system for grants, with a federated view of pending proposals.",
          "Faculty-curated expertise tags, refreshed annually with a one-click workflow.",
        ],
      },
      {
        heading: "Ship a useful slice first",
        body: [
          "Synozur prioritized the \"who works on X\" search experience as the first user-visible deliverable — a single search box for the research office and advancement, backed by the new graph. It went live in 14 weeks.",
        ],
      },
      {
        heading: "Open it up safely",
        body: [
          "Once the internal users were confident, Synozur designed the external expertise portal, the privacy review process for opt-out, and the API contract that let school-level sites consume the same data without forking it.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "The expertise graph became the way the university answered partnership questions — internally for the provost and advancement, and externally for industry and foundations. Two large multi-disciplinary proposals were assembled in days rather than weeks, and both were funded.",
      ],
      bullets: [
        "Single search experience replaced an email-driven scavenger hunt.",
        "Treaties between systems eliminated the recurring \"whose number is right\" debate.",
        "External expertise portal launched with faculty opt-in exceeding 80%.",
      ],
    },
    metrics: [
      { label: "Time-to-find for grant and expertise data", value: "−60%" },
      { label: "Faculty opt-in to external portal", value: "80%+" },
      { label: "Systems reconciled into the graph", value: "7" },
    ],
    quote: {
      text: "We had spent years arguing about which system was right. Synozur got us to stop arguing, write the treaties down, and ship something useful in a single semester.",
      attribution: "Vice President for Research, Global Research University",
    },
  },
];

export function getCaseStudyBySlug(slug: string): CaseStudy | undefined {
  return caseStudies.find((cs) => cs.slug === slug);
}
