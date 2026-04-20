export type CTA = {
    label: string;
    href: string;
  };

  export type FAQItem = {
    q: string;
    a: string;
  };

  export type Workshop = {
    slug: string;
    title: string;
    category: string;
    shortDescription: string;
    heroHeadline: string;
    heroSubhead: string;
    heroImage: string;
    heroTrustBullets: string[];
    primaryCTA: CTA;
    secondaryCTA?: CTA;
    deliveryFormat: string;
    duration: string;
    whoItsFor: string[];
    idealParticipants: string[];
    prerequisites: string[];
    pain: { header: string; lead: string; tiles: string[] };
    scope: { header: string; summary: string; bullets: string[]; included: string[] };
    process: { header: string; steps: string[] };
    deliverables: {
      header: string;
      core: string[];
      executive: string[];
      enablement: string[];
      addOns: string[];
    };
    price: {
      label: string;
      startingAt?: number;
      display: string;
      timeline: string;
      whatIsIncluded: string[];
    };
    diagnostic?: {
      header: string;
      summary: string;
      whatWeAssess: string[];
      questionnairePreview: string[];
      sampleOutputLink?: string;
    };
    competitiveIntel?: {
      header: string;
      summary: string;
      outputs: string[];
    };
    toolingNote?: string;
    outcomes: { header: string; bullets: string[] };
    beforeExample: string;
    afterExample: string;
    sampleDeliverables: {
      header: string;
      link?: string;
      thumbs: string[];
    };
    faq: { header: string; items: FAQItem[] };
    seo: { title: string; description: string };
  };

  export const workshops: Workshop[] = [
  {
    "slug": "ai-academy-immersive-ai-leadership-day",
    "title": "AI Academy - Immersive AI Leadership Day",
    "category": "AI Strategy & Design",
    "shortDescription": "A leadership session that cuts through AI hype, builds shared understanding, and identifies practical, high-impact opportunities tailored to your business.",
    "heroHeadline": "AI Academy - Immersive AI Leadership Day",
    "heroSubhead": "Build confidence in what AI can do for your organization, then leave with a prioritized set of use cases and next steps — grounded in real business outcomes.",
    "heroImage": "/images/workshops/ai-academy-immersive-ai-leadership-day.jpg",
    "heroTrustBullets": [
      "Executive-friendly briefing on AI trends, risks, and opportunities",
      "Practical demonstrations tied to modern work scenarios",
      "Facilitated prioritization to create an actionable opportunity blueprint"
    ],
    "primaryCTA": {
      "label": "Request a Private Workshop",
      "href": "https://www.synozur.com/start"
    },
    "secondaryCTA": {
      "label": "Talk with our team",
      "href": "mailto:contactus@synozur.com"
    },
    "deliveryFormat": "On-site or Virtual",
    "duration": "4–6 hours (one-day session)",
    "whoItsFor": [
      "CEOs and business leaders",
      "CIO/CTO and IT leadership",
      "Innovation, operations, and transformation leaders"
    ],
    "idealParticipants": [
      "Executive sponsor",
      "IT lead for data/security",
      "2–4 business leaders representing key functions"
    ],
    "prerequisites": [
      "Bring 2–3 business priorities you want to accelerate",
      "Optional: a strategy deck or annual goals document"
    ],
    "pain": {
      "header": "Why this workshop exists",
      "lead": "AI can create real advantage, but most leadership teams are stuck between hype, risk concerns, and too many tools — making it hard to choose where to start.",
      "tiles": [
        "Your team is hearing different AI stories, so alignment is low",
        "Use cases are fuzzy, so pilots stall or never launch",
        "Risk and governance questions slow momentum"
      ]
    },
    "scope": {
      "header": "What you’re buying",
      "summary": "A focused leadership experience that moves from clarity to action: we brief leaders on what matters, show real demonstrations, then co-design and prioritize the AI opportunities most likely to deliver ROI in your environment.",
      "bullets": [
        "Separate hype from reality with clear examples",
        "Identify the right AI opportunities for your priorities",
        "Define quick wins vs. strategic bets with ownership and next steps"
      ],
      "included": [
        "Executive AI briefing and risk framing",
        "Demonstrations mapped to business scenarios",
        "Facilitated use-case ideation and prioritization",
        "Draft roadmap and recommended next steps"
      ]
    },
    "process": {
      "header": "How it works",
      "steps": [
        "Executive briefing: trends, risks, and opportunity areas",
        "Demonstrations: modern work scenarios tailored to your context",
        "Guided exploration (hands-on when feasible)",
        "Design-thinking workshop to generate candidate use cases",
        "Prioritization by impact, feasibility, and time-to-value",
        "Synthesis into an AI Opportunity Blueprint"
      ]
    },
    "deliverables": {
      "header": "Deliverables",
      "core": [
        "AI Opportunity Blueprint (prioritized use cases + rationale)",
        "Quick wins vs. strategic bets map",
        "Recommended next steps for pilots, governance, and adoption"
      ],
      "executive": [
        "Executive summary memo suitable for leadership alignment"
      ],
      "enablement": [
        "Optional: draft internal narrative to align teams on the “why” and the first 90 days"
      ],
      "addOns": [
        "Optional: pilot design sprint",
        "Optional: AI adoption and governance roadmap"
      ]
    },
    "price": {
      "label": "Starting at",
      "startingAt": 20000,
      "display": "Starting at $20,000",
      "timeline": "1 day (scheduled as a single session)",
      "whatIsIncluded": [
        "Facilitated leadership workshop",
        "Prioritized opportunity blueprint",
        "Clear next steps and recommended path forward"
      ]
    },
    "diagnostic": {
      "header": "Optional diagnostic module (recommended)",
      "summary": "If helpful, we add a lightweight readiness snapshot to identify the biggest blockers to adoption — so your first pilots are set up to succeed.",
      "whatWeAssess": [
        "Data readiness",
        "Security and governance posture",
        "Change and adoption readiness",
        "Operating model considerations"
      ],
      "questionnairePreview": [
        "How clear are your AI use-case owners and decision paths?",
        "How well defined are your data permissions and governance controls?"
      ]
    },
    "toolingNote": "Synozur uses internal frameworks and accelerators to strengthen rigor and speed — clients receive the outcomes and artifacts, not the tools.",
    "outcomes": {
      "header": "Outcomes",
      "bullets": [
        "Shared leadership clarity on AI’s real potential",
        "A prioritized set of use cases tied to business outcomes",
        "Momentum to move from curiosity to action with confidence"
      ]
    },
    "beforeExample": "“We should do something with AI, but we’re not sure where to start.”",
    "afterExample": "“We have a prioritized AI opportunity blueprint, owners, and a practical first-pilot plan.”",
    "sampleDeliverables": {
      "header": "Sample deliverables (available on request)",
      "thumbs": ["/images/workshops/ai-academy-sample1.jpg","/images/workshops/ai-academy-sample2.jpg","/images/workshops/ai-academy-sample3.jpg"]
    },
    "faq": {
      "header": "FAQ",
      "items": [
        {
          "q": "Is this technical?",
          "a": "It’s leadership-focused and outcome-driven. We keep the language clear and practical, and we bring in technical depth only when needed."
        },
        {
          "q": "Do we need any tools in place?",
          "a": "No. We meet you where you are and tailor next steps to your environment and constraints."
        }
      ]
    },
    "seo": {
      "title": "AI Academy - Immersive AI Leadership Day",
      "description": "A leadership workshop that demystifies AI, aligns executives, and produces a prioritized AI opportunity blueprint grounded in practical outcomes."
    }
  },
  {
    "slug": "m365-academy-microsoft-365-transformation-day",
    "title": "M365 Academy - Microsoft 365 Transformation Day",
    "category": "Microsoft 365 Transformation",
    "shortDescription": "A one-day workshop that reframes Microsoft 365 as a strategic platform — revealing underused capabilities and producing a practical modernization roadmap.",
    "heroHeadline": "M365 Academy - Microsoft 365 Transformation Day",
    "heroSubhead": "Unlock the tools you already own, improve everyday work, and align business and IT on the highest-value initiatives.",
    "heroImage": "/images/workshops/m365-academy-microsoft-365-transformation-day.jpg",
    "heroTrustBullets": [
      "Targeted demonstrations across Teams, SharePoint, Power Platform, Viva, and Copilot",
      "Scenario mapping that connects business pain to specific M365 capabilities",
      "A prioritized action plan to accelerate adoption and ROI"
    ],
    "primaryCTA": {
      "label": "Request a Private Workshop",
      "href": "https://www.synozur.com/start"
    },
    "secondaryCTA": {
      "label": "Talk with our team",
      "href": "mailto:contactus@synozur.com"
    },
    "deliveryFormat": "On-site or Virtual",
    "duration": "1 day",
    "whoItsFor": [
      "CIO/IT leadership",
      "Business leaders responsible for productivity",
      "Digital workplace and collaboration owners"
    ],
    "idealParticipants": [
      "Executive sponsor",
      "M365 technical owner",
      "3–6 business leaders from key functions"
    ],
    "prerequisites": [
      "Bring your top collaboration/productivity pain points",
      "Optional: current governance or adoption materials"
    ],
    "pain": {
      "header": "Why this workshop exists",
      "lead": "Most organizations own powerful M365 capabilities but only use a fraction — leaving productivity, automation, and knowledge gains on the table.",
      "tiles": [
        "Too many tools and overlapping apps create confusion",
        "Governance gaps slow adoption and increase risk",
        "Teams don’t know what’s possible, so value stays unrealized"
      ]
    },
    "scope": {
      "header": "What you’re buying",
      "summary": "An executive-friendly modernization day: we demonstrate what’s possible, then connect it to your workflows and priorities to produce a practical action plan that makes adoption achievable.",
      "bullets": [
        "Discover underused features you already pay for",
        "Map real business problems to M365 solutions",
        "Prioritize quick wins and governance improvements"
      ],
      "included": [
        "Curated demos aligned to your needs",
        "Facilitated scenario mapping",
        "Prioritized action plan",
        "Adoption and governance recommendations"
      ]
    },
    "process": {
      "header": "How it works",
      "steps": [
        "Orientation: your current state and priorities",
        "Demonstrations: high-value capabilities relevant to your teams",
        "Guided exploration (hands-on when feasible)",
        "Scenario mapping: pain points to features and patterns",
        "Prioritization: quick wins vs. strategic investments",
        "Roadmap: actions, owners, and next steps"
      ]
    },
    "deliverables": {
      "header": "Deliverables",
      "core": [
        "M365 Modernization Mini-Roadmap",
        "Quick-win opportunity list",
        "Governance and adoption recommendations"
      ],
      "executive": [
        "Executive summary memo for alignment and sponsorship"
      ],
      "enablement": [
        "Optional: communications and adoption rhythm outline"
      ],
      "addOns": [
        "Optional: governance design sprint",
        "Optional: adoption campaign and measurement plan"
      ]
    },
    "price": {
      "label": "Starting at",
      "startingAt": 20000,
      "display": "Starting at $20,000",
      "timeline": "1 day",
      "whatIsIncluded": [
        "Demonstrations and facilitated mapping",
        "Prioritized roadmap",
        "Adoption and governance next steps"
      ]
    },
    "diagnostic": {
      "header": "Optional diagnostic module (recommended)",
      "summary": "We can add a brief maturity snapshot to surface governance and adoption blockers, so your roadmap is realistic and right-sized.",
      "whatWeAssess": [
        "Information architecture and governance",
        "Collaboration patterns and adoption",
        "Automation readiness",
        "Content hygiene and risk hotspots"
      ],
      "questionnairePreview": [
        "How consistently are standards applied across Teams and SharePoint?",
        "How do you measure adoption and outcomes today?"
      ]
    },
    "toolingNote": "Synozur uses internal accelerators to speed insight and strengthen consistency — clients receive the plan and artifacts, not the tools.",
    "outcomes": {
      "header": "Outcomes",
      "bullets": [
        "Faster adoption of high-value capabilities",
        "Reduced tool sprawl and clearer governance",
        "Improved alignment between business and IT on what to do next"
      ]
    },
    "beforeExample": "“We have M365, but adoption is uneven and we’re still paying for too many extra tools.”",
    "afterExample": "“We have a prioritized modernization roadmap and a clear governance and adoption path.”",
    "sampleDeliverables": {
      "header": "Sample deliverables (available on request)",
      "thumbs": ["/images/workshops/m365-sample1.jpg","/images/workshops/m365-sample2.jpg","/images/workshops/m365-sample3.jpg"]
    },
    "faq": {
      "header": "FAQ",
      "items": [
        {
          "q": "Will this be specific to our environment?",
          "a": "Yes. We tailor demos and recommendations to your constraints, culture, and business priorities."
        },
        {
          "q": "Do you implement?",
          "a": "We design the strategy and roadmap and can guide execution with you or your implementation partners."
        }
      ]
    },
    "seo": {
      "title": "M365 Academy — Microsoft 365 Transformation Day",
      "description": "A one-day workshop that unlocks Microsoft 365 value and delivers a prioritized modernization roadmap with adoption and governance recommendations."
    }
  },
  {
    "slug": "company-operating-system-bootcamp-two-day",
    "title": "Company Operating System Bootcamp - Two-Day Leadership Workshop",
    "category": "Leadership & Organizational Transformation",
    "shortDescription": "A two-day leadership workshop to define how your company runs — aligning culture, strategy, goals, and operating rhythms into a practical operating system for execution.",
    "heroHeadline": "Company Operating System Bootcamp - Two-Day Leadership Workshop",
    "heroSubhead": "Design the blueprint for how your organization operates — so strategy becomes a living system, not a slide deck.",
    "heroImage": "/images/workshops/company-operating-system-bootcamp-two-day.jpg",
    "heroTrustBullets": [
      "Facilitated leadership alignment on culture, values, and strategic priorities",
      "Practical operating rhythm design (cadence, decisions, accountability)",
      "A blueprint report your team can implement immediately"
    ],
    "primaryCTA": {
      "label": "Request a Private Workshop",
      "href": "https://www.synozur.com/start"
    },
    "secondaryCTA": {
      "label": "Talk with our team",
      "href": "mailto:contactus@synozur.com"
    },
    "deliveryFormat": "On-site (recommended) or Hybrid",
    "duration": "2 days",
    "whoItsFor": [
      "CEOs, COOs, and leadership teams",
      "Organizations scaling or navigating change",
      "Leaders who want stronger alignment and execution"
    ],
    "idealParticipants": [
      "CEO/COO",
      "Functional leaders",
      "People/operations lead",
      "Optional: strategy or finance partner"
    ],
    "prerequisites": [
      "Bring your current strategy/annual goals (if available)",
      "Bring known pain points in execution, meetings, or accountability"
    ],
    "pain": {
      "header": "Why this workshop exists",
      "lead": "Many teams have strong intentions but weak operating rhythms — meetings drift, priorities shift, and execution depends on heroics instead of a system.",
      "tiles": [
        "Too many priorities, not enough focus",
        "Decisions happen inconsistently",
        "Execution rhythms don’t scale with the organization"
      ]
    },
    "scope": {
      "header": "What you’re buying",
      "summary": "A two-day facilitated design experience where leadership teams clarify foundations, define priorities, and build a practical operating rhythm — creating the management blueprint for consistent execution.",
      "bullets": [
        "Align on values, priorities, and decision-making",
        "Define quarterly focus and accountability",
        "Build a cadence that turns leadership time into outcomes"
      ],
      "included": [
        "Leadership alignment exercises",
        "Strategy and priority design",
        "Operating rhythm and meeting cadence design",
        "Synthesis into a Company OS Blueprint"
      ]
    },
    "process": {
      "header": "How it works",
      "steps": [
        "Day 1: Foundations + alignment (values, strategy, goals, rhythms)",
        "Day 2: Applied design (priorities, “big rocks,” decision paths, operating cadence)",
        "Close: Synthesis and next-step plan"
      ]
    },
    "deliverables": {
      "header": "Deliverables",
      "core": [
        "Company OS Blueprint Report",
        "Draft strategic priorities and quarterly “big rocks”",
        "Operating rhythm (cadence, meetings, decision paths)"
      ],
      "executive": [
        "Executive alignment summary and implementation recommendations"
      ],
      "enablement": [
        "Optional: internal rollout narrative and leadership communication outline"
      ],
      "addOns": [
        "Optional: follow-on engagement to operationalize and refine the Company OS",
        "Optional: metrics and rhythm instrumentation"
      ]
    },
    "price": {
      "label": "Starting at",
      "startingAt": 20000,
      "display": "Starting at $20,000",
      "timeline": "2 days",
      "whatIsIncluded": [
        "Two-day facilitated leadership workshop",
        "Company OS Blueprint report",
        "Clear next steps for implementation"
      ]
    },
    "diagnostic": {
      "header": "Optional diagnostic module (recommended)",
      "summary": "We can add a brief leadership and operating maturity snapshot to focus the workshop on the most important execution gaps — quickly.",
      "whatWeAssess": [
        "Leadership alignment and decision-making",
        "Goal-setting and accountability",
        "Meeting cadence and operating rhythms",
        "Culture and adoption considerations"
      ],
      "questionnairePreview": [
        "How consistently are priorities translated into quarterly execution?",
        "How clear are decision paths and ownership?"
      ]
    },
    "toolingNote": "Synozur uses internal frameworks and planning accelerators to keep the work structured and actionable — you receive the blueprint and operating rhythm, not the tools.",
    "outcomes": {
      "header": "Outcomes",
      "bullets": [
        "Leadership alignment around what matters most",
        "A disciplined operating cadence that scales",
        "Faster decisions and more consistent execution"
      ]
    },
    "beforeExample": "“Leadership time is busy, but outcomes are inconsistent.”",
    "afterExample": "“We have a clear operating rhythm and a blueprint for accountable execution.”",
    "sampleDeliverables": {
      "header": "Sample deliverables (available on request)",
      "thumbs": ["/images/workshops/cos-sample1.jpg","/images/workshops/cos-sample2.jpg","/images/workshops/cos-sample3.jpg"]
    },
    "faq": {
      "header": "FAQ",
      "items": [
        {
          "q": "Is this a strategy retreat?",
          "a": "It’s more practical than a retreat. We design the operating system — the rhythms, decisions, and accountability that turn strategy into action."
        },
        {
          "q": "Do you implement the changes?",
          "a": "We can guide implementation and refinement, working alongside your team or implementation partners."
        }
      ]
    },
    "seo": {
      "title": "Company Operating System Bootcamp — Two-Day Leadership Workshop | Synozur",
      "description": "A two-day leadership workshop to align culture and strategy and design the operating rhythm and accountability system that makes execution achievable."
    }
  },
  {
    "slug": "go-to-market-proxy-pitch-assessment",
    "title": "Go-to-Market Proxy Pitch Assessment",
    "category": "Go-to-Market Transformation",
    "shortDescription": "A premium, buyer-style simulation that stress-tests your pitch and narrative across personas — then delivers a board-ready assessment and improvement plan.",
    "heroHeadline": "Go-to-Market Proxy Pitch Assessment",
    "heroSubhead": "See your pitch the way real buyers do, uncover the blind spots that cost deals, and leave with a prioritized plan to sharpen differentiation and improve win rates.",
    "heroImage": "/images/workshops/go-to-market-proxy-pitch-assessment.jpg",
    "heroTrustBullets": [
      "Realistic buying-committee simulation (finance, technical, operator, end-user lenses)",
      "Structured narrative and differentiation analysis grounded in competitive context",
      "Confidential assessment report with prioritized recommendations"
    ],
    "primaryCTA": {
      "label": "Request a Private Workshop",
      "href": "https://www.synozur.com/start"
    },
    "secondaryCTA": {
      "label": "See Sample Deliverables",
      "href": ""
    },
    "deliveryFormat": "Virtual or On-site",
    "duration": "Assessment + readout (typically over ~2 weeks)",
    "whoItsFor": [
      "Sales and marketing leaders",
      "Founders and product leaders",
      "Teams preparing for enterprise deals or major launches"
    ],
    "idealParticipants": [
      "Pitch owner",
      "Sales leader",
      "Product/marketing lead",
      "1–2 SMEs for objections and proof points"
    ],
    "prerequisites": [
      "Current pitch deck and talk track",
      "Optional: demo narrative and recent objection themes",
      "Optional: list of key competitors"
    ],
    "pain": {
      "header": "Why this assessment exists",
      "lead": "Most teams never hear the honest buyer perspective. Internal rehearsals can’t replicate real committee dynamics — so blind spots persist until they show up as lost deals.",
      "tiles": [
        "Your value is real, but buyers can’t repeat it back",
        "Differentiation sounds generic under scrutiny",
        "Objections derail conversations because proof points aren’t crisp"
      ]
    },
    "scope": {
      "header": "What you’re buying",
      "summary": "A high-rigor, outside-in assessment that simulates real buying dynamics, evaluates your narrative and positioning, and delivers a prioritized plan to strengthen your pitch and go-to-market execution.",
      "bullets": [
        "Multi-persona simulation with candid feedback",
        "Competitive and differentiation overlay to pressure-test claims",
        "Actionable recommendations you can implement immediately"
      ],
      "included": [
        "Intake and context gathering",
        "Buying-committee simulation",
        "Structured debrief",
        "Assessment report with prioritized improvements",
        "Enablement-ready recommendations"
      ]
    },
    "process": {
      "header": "How it works",
      "steps": [
        "Intake: deck, talk track, ICP, competitor set",
        "Competitive context build to pressure-test differentiation",
        "Proxy pitch simulation with a realistic buying committee",
        "Persona-by-persona debrief: what resonated, what confused, what failed",
        "Recommendations: narrative fixes, proof points, objection handling",
        "Final report: scoring, priority actions, and next-step plan"
      ]
    },
    "deliverables": {
      "header": "Deliverables",
      "core": [
        "Proxy Pitch Scorecard (clarity, differentiation, credibility, proof)",
        "Persona Response Matrix (what each buyer heard and needed)",
        "Competitive Narrative Overlay (where competitors win the story)",
        "Prioritized Fix List and 30/60/90 plan"
      ],
      "executive": [
        "CEO/COO-ready executive summary memo",
        "Risk and opportunity highlights"
      ],
      "enablement": [
        "Updated talk tracks and objection responses",
        "Slide/story-beat rewrite recommendations"
      ],
      "addOns": [
        "Live pitch rehearsal and coaching",
        "Full deck rewrite",
        "Enablement kit refresh (talk tracks, battlecards)"
      ]
    },
    "price": {
      "label": "Starting at",
      "startingAt": 20000,
      "display": "Starting at $20,000",
      "timeline": "~2 weeks typical",
      "whatIsIncluded": [
        "Simulation + debrief",
        "Board-ready assessment report",
        "Prioritized GTM improvement plan"
      ]
    },
    "diagnostic": {
      "header": "Optional diagnostic module (recommended)",
      "summary": "When useful, we add a structured maturity snapshot to identify the GTM capability gaps that are driving pitch friction — and what to fix first.",
      "whatWeAssess": [
        "Market fit clarity (ICP, segmentation)",
        "Messaging and positioning consistency",
        "Pricing/packaging discipline",
        "Demand engine and sales enablement maturity",
        "Collateral health and journey mapping"
      ],
      "questionnairePreview": [
        "How clearly defined and validated is your ICP and segmentation?",
        "How actively is your messaging framework used in sales and launches?",
        "How value-based and disciplined is pricing across tiers and discounting?"
      ]
    },
    "competitiveIntel": {
      "header": "Competitive context (included)",
      "summary": "We ground recommendations in market reality by overlaying competitive signals and positioning patterns, so your differentiation holds up in real deals.",
      "outputs": [
        "Competitive positioning overlay",
        "Differentiation gaps and narrative collisions",
        "Battlecard-ready findings and objection patterns"
      ]
    },
    "toolingNote": "Synozur uses internal intelligence and assessment workflows to strengthen rigor and speed — clients receive the findings and artifacts, not the tools.",
    "outcomes": {
      "header": "Outcomes",
      "bullets": [
        "A sharper pitch buyers can repeat",
        "Clearer differentiation under executive scrutiny",
        "Persona-specific talk tracks that reduce stalls",
        "A prioritized plan to improve win rates and market traction"
      ]
    },
    "beforeExample": "“We explain what we do, but buyers still don’t get why we’re different.”",
    "afterExample": "“We have a defensible story, proof points, and talk tracks tailored to each buyer persona.”",
    "sampleDeliverables": {
      "header": "Sample deliverables (available on request)",
      "thumbs": ["/images/workshops/gtm-sample1.jpg","/images/workshops/gtm-sample2.jpg","/images/workshops/gtm-sample3.jpg"]
    },
    "faq": {
      "header": "FAQ",
      "items": [
        {
          "q": "Is this just a pitch critique?",
          "a": "No. It’s a buyer-style simulation plus structured narrative, differentiation, and competitive context — delivered as a prioritized improvement plan."
        },
        {
          "q": "Do you share your internal tools?",
          "a": "No. We use internal accelerators to improve rigor and speed; you receive the artifacts and outcomes."
        }
      ]
    },
    "seo": {
      "title": "Go-to-Market Proxy Pitch Assessment | Synozur",
      "description": "A premium buyer-style simulation and GTM assessment that delivers a scorecard, persona matrix, and a prioritized plan to sharpen differentiation and improve win rates."
    }
  }
];

  export function getWorkshopBySlug(slug: string): Workshop | undefined {
    return workshops.find((w) => w.slug === slug);
  }
  