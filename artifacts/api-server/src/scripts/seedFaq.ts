/**
 * Idempotent FAQ seed — clears existing data and inserts all categories + items
 * from the official Synozur FAQ document (January 2026).
 *
 * Run: npx tsx src/scripts/seedFaq.ts
 */

import { db, faqCategoriesTable, faqItemsTable } from "@workspace/db";

function p(...lines: string[]): string {
  return lines.map((l) => `<p>${l}</p>`).join("\n");
}

function ul(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

const NOW = new Date();

const CATEGORIES: Array<{
  slug: string;
  name: string;
  description: string;
  order: number;
  items: Array<{ question: string; answer: string; slug: string }>;
}> = [
  {
    slug: "about-synozur",
    name: "About Synozur",
    description: "Who we are, what we do, and what makes us different.",
    order: 10,
    items: [
      {
        slug: "what-is-synozur",
        question: "What is Synozur?",
        answer:
          p("Synozur is a woman-owned advisory firm focused on transforming business for clients, making the desirable achievable. As &ldquo;the transformation company,&rdquo; Synozur guides organizations to their North Star by charting the course through transformation rooted in people, powered by technology, and driven by purpose.") +
          p("The company specializes in strategic advisory services including AI strategy and design, Microsoft 365 adoption, go-to-market transformation for Microsoft partners, and business strategy development."),
      },
      {
        slug: "what-does-synozur-mean",
        question: "What does the name \"Synozur\" mean?",
        answer: p("Synozur is inspired by the Greek word for the North Star, symbolizing the company&rsquo;s unwavering commitment to guiding clients to success. Just as the North Star has been a beacon of navigation for centuries, Synozur serves as the central point of orientation in the digital sky, steering organizations toward their desired outcomes with precision and clarity."),
      },
      {
        slug: "where-is-synozur-located",
        question: "Where is Synozur located?",
        answer: p("Synozur is headquartered in Bothell, Washington, United States with staff throughout the US and Canada. The company serves clients across multiple industries and geographies through its boutique advisory model."),
      },
      {
        slug: "what-industries-does-synozur-serve",
        question: "What industries does Synozur serve?",
        answer: p("Synozur serves midmarket organizations across multiple industries including communications, professional services, public sector, retail, manufacturing, distribution, and casino/tribal enterprises. The company has particular expertise working with organizations undergoing digital transformation and AI adoption initiatives."),
      },
      {
        slug: "what-makes-synozur-different",
        question: "What makes Synozur different from other consulting firms?",
        answer:
          p("Synozur combines boutique agility with Fortune 500 expertise. Key differentiators include:") +
          ul([
            "A strategic, outcome-focused approach that aligns solutions to business goals",
            "Human-centered design and empathy in transformation",
            "Seasoned expertise with boutique agility",
            "Deep Microsoft ecosystem mastery as a Microsoft Solutions Partner",
            "Flexible, custom engagements tailored to each client&rsquo;s unique needs",
          ]),
      },
      {
        slug: "what-values-does-synozur-emphasize",
        question: "What values does Synozur emphasize in its services?",
        answer:
          p("Synozur builds every engagement on a clear set of values that shape how we partner with organizations and deliver transformation.") +
          ul([
            "<strong>Empathetic, human-centered approach</strong> &mdash; We listen first, understand the challenges leaders and employees face, and design solutions around real human needs rather than abstract frameworks or generic consulting playbooks.",
            "<strong>Tailored, custom solutions</strong> &mdash; No two clients share the same goals, culture, or constraints, so Synozur rejects one-size-fits-all methods. Every strategy, operating model, and roadmap is shaped intentionally for the organization we are serving.",
            "<strong>Outcome-orientation</strong> &mdash; We align all work to tangible business results&mdash;clarity, alignment, productivity, adoption, and sustained success&mdash;so transformation becomes achievable and measurable rather than theoretical.",
            "<strong>Guidance, navigation, and partnership</strong> &mdash; We see ourselves as navigators of change, helping leadership teams make confident decisions, chart smart paths forward, and communicate the &ldquo;why&rdquo; behind change throughout the organization.",
            "<strong>Deep ecosystem expertise with accessible communication</strong> &mdash; Our Microsoft mastery, strategic clarity, and design-thinking mindset are always delivered in a supportive, respectful way that is easy for leaders and employees to embrace.",
          ]) +
          p("In short: Synozur&rsquo;s values are empathy, human-centered design, tailored strategy, measurable outcomes, trusted partnership, and expert yet accessible guidance&mdash;making transformation not only possible, but sustainable."),
      },
    ],
  },

  {
    slug: "ai-strategy-design",
    name: "AI Strategy & Design",
    description: "AI readiness, roadmaps, Copilot implementation, and ethical AI governance.",
    order: 20,
    items: [
      {
        slug: "what-ai-strategy-services-does-synozur-offer",
        question: "What AI strategy services does Synozur offer?",
        answer: p("Synozur offers comprehensive AI strategy and design services including AI readiness assessments, strategic AI roadmaps, use case identification, governance and ethical AI design, pilot program development, and Microsoft Copilot implementation. The company takes a human-centric approach to AI, ensuring solutions are ethical and considerate of their impact on the workforce."),
      },
      {
        slug: "how-does-synozur-help-implement-microsoft-copilot",
        question: "How does Synozur help organizations implement Microsoft Copilot?",
        answer: p("Synozur provides expertise in Microsoft&rsquo;s AI technologies including Copilot to ensure organizations are fully equipped to implement and manage AI solutions that transform business processes. This includes pilot program design, curriculum-based campaigns, integration with existing Microsoft 365 environments, and comprehensive rollout strategies."),
      },
      {
        slug: "what-is-an-ai-readiness-assessment",
        question: "What is an AI readiness assessment?",
        answer:
          p("An AI readiness assessment evaluates your organization&rsquo;s data quality, technology stack, and business processes in light of AI opportunities. Synozur conducts comprehensive assessments to identify high-impact use cases where AI could solve real problems or create value, such as automating inventory predictions or deploying AI-driven customer support.") +
          p("Take your assessment at <a href=\"https://orion.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">orion.synozur.com</a>."),
      },
      {
        slug: "how-does-synozur-ensure-ethical-ai",
        question: "How does Synozur ensure ethical AI implementation?",
        answer: p("Synozur ensures governance and ethical AI design are built into every plan, establishing policies for data security, privacy, compliance, and human oversight in AI decisions. The company&rsquo;s familiarity with Microsoft&rsquo;s AI platforms means leveraging tools with built-in compliance controls to ensure responsible deployment."),
      },
      {
        slug: "what-ai-use-cases-does-synozur-implement",
        question: "What AI use cases does Synozur typically help organizations implement?",
        answer:
          p("Common AI use cases include:") +
          ul([
            "Predictive maintenance models",
            "Power Platform chatbots for employee support",
            "AI-driven customer engagement",
            "Automated inventory forecasting",
            "Quality control via image recognition",
            "Process automation",
          ]) +
          p("Each use case is tailored to the organization&rsquo;s specific needs and business objectives."),
      },
      {
        slug: "ai-transformation-for-private-equity",
        question: "How does Synozur approach AI transformation for private equity firms?",
        answer: p("For private equity technology and investment leaders managing $1B+ in assets, Synozur develops tailored AI strategies and roadmaps for portfolio companies aligned to business outcomes. Services include identifying high-impact AI use cases, ensuring responsible AI adoption with governance and privacy controls, demonstrating quick wins and scalable pilots, and leveraging the Microsoft ecosystem for cost-effective transformation."),
      },
    ],
  },

  {
    slug: "microsoft-365-advisory",
    name: "Microsoft 365 Advisory & Adoption",
    description: "M365 strategy, optimization, employee effectiveness, and adoption services.",
    order: 30,
    items: [
      {
        slug: "what-microsoft-365-services-does-synozur-provide",
        question: "What Microsoft 365 services does Synozur provide?",
        answer: p("Synozur develops technology strategies and roadmaps that align with business imperatives, working with leadership teams to maximize innovation and ROI. Services include Microsoft 365 optimization, employee effectiveness strategies, communication and collaboration improvements, adoption strategies, and integration with AI tools like Microsoft Copilot."),
      },
      {
        slug: "how-does-synozur-improve-employee-effectiveness-with-m365",
        question: "How does Synozur improve employee effectiveness with Microsoft 365?",
        answer: p("Synozur focuses on the people behind the platforms, improving the employee experience through smarter communication, collaboration, and adoption strategies. The goal is creating a modern workplace where productivity and satisfaction go hand in hand through optimized use of Microsoft Teams, SharePoint, and other Microsoft 365 tools."),
      },
      {
        slug: "synozur-approach-to-m365-adoption",
        question: "What is Synozur's approach to Microsoft 365 adoption?",
        answer: p("Synozur takes an empathetic, people-centric approach to Microsoft 365 adoption. This includes understanding employee experience, engagement, and change management at every step to ensure high adoption and sustained success. Training programs and curriculum-based campaigns ensure users understand and trust new systems."),
      },
      {
        slug: "can-synozur-help-with-teams-sharepoint",
        question: "Can Synozur help with Microsoft Teams and SharePoint optimization?",
        answer: p("Yes, Synozur has deep Microsoft ecosystem expertise and can help optimize Microsoft Teams, SharePoint, OneDrive, and other Microsoft 365 applications. This includes governance frameworks, collaboration strategies, content management, and integration with business processes."),
      },
    ],
  },

  {
    slug: "gtm-microsoft-partners",
    name: "Go-to-Market for Microsoft Partners",
    description: "Partner development, co-sell, ISV and SI growth through the Microsoft ecosystem.",
    order: 40,
    items: [
      {
        slug: "gtm-services-for-microsoft-partners",
        question: "What GTM transformation services does Synozur offer Microsoft partners?",
        answer: p("Synozur helps Microsoft partners navigate the ecosystem by building strong relationships, aligning to Microsoft&rsquo;s GTM strategy, and unlocking co-sell opportunities. Services include Microsoft partner development, channel development, brand and messaging transformation, go-to-market plan development, and campaign execution."),
      },
      {
        slug: "how-synozur-helps-isvs-with-microsoft",
        question: "How does Synozur help ISVs leverage the Microsoft ecosystem?",
        answer: p("For Independent Software Vendors (ISVs), Synozur acts as a navigator of the Microsoft ecosystem, helping chart plans to maximize partnerships. This includes crafting joint value propositions, connecting with key Microsoft contacts, enrolling in Microsoft co-sell programs, achieving advanced specializations, and aligning product roadmaps with Microsoft&rsquo;s strategic themes."),
      },
      {
        slug: "what-is-microsoft-co-sell",
        question: "What is Microsoft Co-sell and how can Synozur help?",
        answer: p("Microsoft Co-sell is a program where Microsoft sellers bring partner solutions into customer deals. Synozur helps partners achieve tighter alignment with Microsoft&rsquo;s go-to-market engine, gain access to partner incentives and funding, and raise their profile through AppSource, events, and Microsoft channels."),
      },
      {
        slug: "how-synozur-helps-sis-with-microsoft",
        question: "How does Synozur help systems integrators (SIs) grow with Microsoft?",
        answer: p("For midsize systems integrators, Synozur evaluates current services and maps them to Microsoft&rsquo;s priorities and Solution Areas. The company connects SI leaders with key Microsoft stakeholders, trains teams on Microsoft&rsquo;s language, helps attain advanced specializations, and clarifies how to deliver both customer value and Microsoft value."),
      },
      {
        slug: "value-of-microsoft-partner-ecosystem",
        question: "What is the value of the Microsoft partner ecosystem?",
        answer: p("The Microsoft partner ecosystem represents a TAM of $661B by 2025, and successful partners can earn $7&ndash;$10 for every $1 Microsoft sells. Synozur helps partners tap into this opportunity through strategic alignment, relationship building, and program participation."),
      },
    ],
  },

  {
    slug: "business-strategy-company-os",
    name: "Business Strategy & Company OS",
    description: "Company Operating System, OKRs, strategic transformation, and fractional leadership.",
    order: 50,
    items: [
      {
        slug: "what-is-a-company-operating-system",
        question: "What is a Company Operating System (Company OS)?",
        answer:
          p("A Company Operating System aligns your purpose, goals, and execution strategy into a unified model. Synozur helps organizations implement this framework to improve clarity, accountability, and operational performance across the organization. It transforms how leadership teams manage strategy, planning, and execution.") +
          p("Experience it at <a href=\"https://vega.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">vega.synozur.com</a>."),
      },
      {
        slug: "difference-between-strategy-and-planning",
        question: "What is the difference between strategy and planning?",
        answer:
          p("Strategy and planning are fundamentally different. Strategy involves making choices where outcomes are beyond your control, such as expanding product lines or entering new markets. Planning involves specific tactics and actions to execute your strategy, such as organizing training events or launching campaigns.") +
          p("As Synozur states: &ldquo;There is no such thing as &lsquo;strategic planning.&rsquo;&rdquo;"),
      },
      {
        slug: "what-are-okrs-and-how-does-synozur-help",
        question: "What are OKRs and how does Synozur help implement them?",
        answer:
          p("OKRs (Objectives and Key Results) are tools used to measure the success of strategies. They provide a framework for setting and tracking goals, focusing on key outcomes that drive strategic objectives forward without needing to encapsulate every tactical activity.") +
          p("Synozur helps organizations implement OKR frameworks with proper hierarchy, weighting, and rollups through <a href=\"https://vega.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">Vega</a>."),
      },
      {
        slug: "what-is-strategic-transformation",
        question: "What is strategic transformation and who needs it?",
        answer: p("Strategic transformation is for midmarket companies needing stronger leadership alignment and strategic focus. It addresses challenges like ineffective leadership meetings (&ldquo;BOPSAT&rdquo; &mdash; Bunch Of People Sitting Around Talking), lack of structured strategy execution, reduced productivity, high turnover, and missed opportunities. Synozur&rsquo;s approach establishes a Company Operating System for scalable management."),
      },
      {
        slug: "what-does-company-os-implementation-include",
        question: "What does Synozur's Company OS implementation include?",
        answer:
          p("Company OS implementation includes:") +
          ul([
            "Defining company foundations &mdash; mission, values, and vision",
            "Translating foundations into pragmatic strategic plans",
            "Introducing regular Focus Rhythms: quarterly OKR setting and weekly leadership stand-ups",
            "Establishing annual and quarterly planning rituals",
            "Providing change management support throughout",
          ]) +
          p("Experience it through <a href=\"https://vega.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">vega.synozur.com</a>."),
      },
      {
        slug: "what-is-fractional-leadership",
        question: "What is fractional leadership and how can it help my organization?",
        answer: p("Fractional CxOs bring high-impact leadership when and where it&rsquo;s needed most. Synozur provides flexible, executive-level guidance that accelerates momentum and bridges capability gaps without long-term overhead. This may include part-time executives to fill gaps or mentor internal managers."),
      },
    ],
  },

  {
    slug: "proprietary-platforms",
    name: "Proprietary Platforms",
    description: "Vega, Orion, Nebula, and Orbit &mdash; Synozur&rsquo;s purpose-built transformation platforms.",
    order: 60,
    items: [
      {
        slug: "what-is-vega",
        question: "What is Vega?",
        answer: p("<a href=\"https://vega.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">Vega</a> is Synozur&rsquo;s AI-augmented Company Operating System designed to bridge the gap between strategy and daily execution. It unifies mission, priorities, OKRs, and meetings into a single operating rhythm that brings clarity, cadence, and accountability across the business."),
      },
      {
        slug: "what-are-vegas-key-features",
        question: "What are Vega's key features?",
        answer:
          p("Vega includes:") +
          ul([
            "Foundations module &mdash; mission, vision, values, and goals",
            "Strategy modules with hierarchical OKRs, weighted key results, and automatic rollups",
            "Focus Rhythm for embedding weekly, monthly, and quarterly cadences",
            "AI assistant for insights, recommendations, and natural language queries",
            "Microsoft 365 integration &mdash; OneDrive, SharePoint, Outlook, Planner",
            "Enterprise security with Microsoft Entra SSO",
            "Viva Goals import capability",
          ]),
      },
      {
        slug: "how-does-vegas-ai-assistant-work",
        question: "How does Vega's AI assistant work?",
        answer:
          p("Vega&rsquo;s AI assistant provides:") +
          ul([
            "Culture-grounded chat with full organizational context",
            "Natural language queries like &ldquo;Show at-risk initiatives&rdquo;",
            "Streaming responses with grounding documents",
            "Predictive analytics and variance alerts",
            "AI-generated progress summaries and at-risk item surfacing",
          ]),
      },
      {
        slug: "what-is-vega-launchpad",
        question: "What is the Vega Launchpad feature?",
        answer: p("The Vega Launchpad allows organizations to instantly generate a tailored Company OS from existing documents. This accelerates setup by importing mission, values, and strategic elements from organizational documents, making it easy to get started with your Company Operating System quickly."),
      },
      {
        slug: "can-vega-import-from-viva-goals",
        question: "Can Vega import data from Microsoft Viva Goals?",
        answer: p("Yes, Vega includes Viva Goals import functionality to preserve OKR continuity and history. Organizations can maintain their historical OKR data when transitioning from the discontinued Viva Goals platform. Visit <a href=\"https://vega.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">vega.synozur.com</a> to explore this capability."),
      },
      {
        slug: "what-is-orion",
        question: "What is Orion?",
        answer:
          p("<a href=\"https://orion.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">Orion</a> is Synozur&rsquo;s AI-powered transformation assessment platform. It provides comprehensive maturity assessments to guide organizations through their transformation journey using structured, data-driven evaluations. Orion delivers personalized AI-powered insights tailored to role, industry, and company size.") +
          p("Most assessments are mapped to a CMMI5 100&ndash;500 point scale."),
      },
      {
        slug: "what-assessments-does-orion-provide",
        question: "What assessments does Orion provide?",
        answer: p("Orion offers multiple maturity assessment models covering AI Maturity, digital transformation, go-to-market maturity, and other essential transformation dimensions. Users receive benchmarking against industry peers, company size, and country averages."),
      },
      {
        slug: "what-is-the-ai-maturity-model-on-orion",
        question: "What is the AI Maturity Model on Orion?",
        answer:
          p("The AI Maturity Model on Orion enables organizations to assess their AI readiness and capabilities across critical dimensions such as strategy, infrastructure, governance, and talent. Users receive a precise maturity score across five stages and contextualized recommendations for improvement.") +
          p("Access it at <a href=\"https://orion.synozur.com/ai-maturity\" target=\"_blank\" rel=\"noopener noreferrer\">orion.synozur.com/ai-maturity</a>."),
      },
      {
        slug: "what-is-nebula",
        question: "What is Nebula?",
        answer: p("Nebula is a multi-tenant collaborative envisioning platform that enables organizations to run structured ideation workshops with real-time participation. Facilitators guide cohorts through configurable modules including brainstorming, AI-powered categorization, pairwise voting, stack ranking, marketplace allocation, 2&times;2 priority matrices, staircase prioritization, and surveys. The platform culminates in AI-generated personalized results for each participant."),
      },
      {
        slug: "what-is-orbit",
        question: "What is Orbit?",
        answer: p("Orbit is Synozur&rsquo;s forthcoming AI-driven marketing intelligence platform, extending the Vega ecosystem with a focus on competitive analysis and messaging insights. As a multitenant SaaS product, Orbit will deliver competitive intelligence, website analysis, messaging recommendations, and strategic marketing insights."),
      },
      {
        slug: "what-is-zenith",
        question: "What is Zenith?",
        answer: p("Zenith is Synozur&rsquo;s Microsoft 365 Governance Command Center. It provides a unified view of your entire M365 tenant, evaluates governance health, and helps organizations safely prepare for and operate Microsoft 365 Copilot."),
      },
      {
        slug: "why-does-zenith-exist",
        question: "Why does Zenith exist?",
        answer: p("Microsoft 365 environments grow quickly and unevenly, creating governance gaps that become AI risks when Copilot is enabled. Zenith gives organizations visibility, control, and confidence to govern content properly and enable Copilot safely."),
      },
      {
        slug: "how-does-zenith-help-m365-organizations",
        question: "How does Zenith help organizations using Microsoft 365?",
        answer: p("Zenith inventories your M365 environment, evaluates it against governance policies, and scores each workspace for Copilot readiness&mdash;helping teams prioritize remediation and enable Copilot only where it is safe."),
      },
      {
        slug: "is-zenith-secure",
        question: "Is Zenith secure and trustworthy with our data?",
        answer: p("Yes. Zenith uses a customer-approved Microsoft Entra app with read-only permissions, evaluates metadata rather than document content, and operates with tenant isolation, role-based access, and full audit logging."),
      },
      {
        slug: "how-does-zenith-leverage-synozur-expertise",
        question: "How does Zenith leverage Synozur's governance and AI expertise?",
        answer: p("Zenith embeds Synozur&rsquo;s real-world Microsoft 365 governance expertise into AI-driven insights, ensuring recommendations and Copilot analytics are grounded in proven best practices&mdash;not generic AI output."),
      },
      {
        slug: "how-do-synozur-platforms-work-together",
        question: "How do Synozur's platforms work together?",
        answer: p("Synozur&rsquo;s platforms are integrated through Galaxy, a centralized services layer that provides unified authentication, tenant management, telemetry, feedback/support, and notifications. This allows Orbit, Orion, Vega, and Nebula to remain autonomously developed while sharing common capabilities."),
      },
    ],
  },

  {
    slug: "transformation-methodology",
    name: "Transformation Approach & Methodology",
    description: "How Synozur approaches change management, Focus Rhythm, and measuring success.",
    order: 70,
    items: [
      {
        slug: "what-is-synozurs-transformation-methodology",
        question: "What is Synozur's transformation methodology?",
        answer: p("Synozur&rsquo;s transformation methodology is empathetic, tailored, and outcome-focused. The company acts as &ldquo;navigators of change&rdquo; who understand challenges, plot new courses, and outline realistic roadmaps. The approach combines strategic clarity with human-centered design to enable measurable outcomes and sustainable change."),
      },
      {
        slug: "what-is-focus-rhythm",
        question: "What is \"Focus Rhythm\" in Synozur's methodology?",
        answer:
          p("Focus Rhythm is Synozur&rsquo;s approach to embedding structured cadences for meetings and execution. It includes:") +
          ul([
            "Meeting management across weekly, monthly, quarterly, and annual cadences",
            "Linking meetings to OKRs and strategic priorities",
            "AI-generated agendas and meeting prep",
            "Decision logging with action item tracking",
          ]) +
          p("This moves organizations beyond unproductive meetings to a strategy-centered culture."),
      },
      {
        slug: "how-does-synozur-measure-transformation-success",
        question: "How does Synozur measure transformation success?",
        answer:
          p("Synozur builds in clear metrics and checkpoints to track outcomes, including:") +
          ul([
            "Progress tracking with check-in history",
            "Point-in-time snapshots for audit trails",
            "Strategic alignment visualization",
            "Values distribution analytics",
            "PDF/PowerPoint export for board presentations",
          ]),
      },
      {
        slug: "synozur-approach-to-change-management",
        question: "What is Synozur's approach to change management?",
        answer: p("Synozur incorporates change management support throughout transformations, communicating the &ldquo;why&rdquo; behind changes to all levels and coaching managers to adopt new practices. The empathetic, people-centric approach ensures employees understand and trust new systems, considering employee experience, engagement, and change management at every step."),
      },
      {
        slug: "does-synozur-provide-implementation-services",
        question: "Does Synozur provide implementation services?",
        answer: p("Synozur drives strategic leadership, culture change, and design &mdash; not implementation. However, the company offers ongoing support beyond initial recommendations, helping implement plans, monitor progress, and adjust as needed. Synozur partners with clients from strategy through execution and refinement."),
      },
    ],
  },

  {
    slug: "client-engagement",
    name: "Client Engagement & Pricing",
    description: "Who Synozur works with, how engagements are structured, and how to get started.",
    order: 80,
    items: [
      {
        slug: "what-types-of-organizations-does-synozur-work-with",
        question: "What types of organizations does Synozur work with?",
        answer:
          p("Synozur primarily serves midmarket organizations (typically 250&ndash;600 employees, $50M&ndash;$100M+ revenue) and midsize Microsoft partners. Ideal clients include:") +
          ul([
            "Scaling midmarket CEOs",
            "Transformational COOs and forward-thinking CIOs",
            "Operations managers driving change",
            "Private equity technology leaders managing $1B+ AUM",
            "Tribal IT leaders at casino revenue tribes",
            "Ambitious ISV founders",
            "Midmarket systems integrator leaders",
          ]),
      },
      {
        slug: "how-does-synozur-structure-engagements",
        question: "How does Synozur structure engagements?",
        answer:
          p("Synozur provides flexible, customizable services including:") +
          ul([
            "Fractional leadership",
            "Project-based consulting",
            "Strategic advisory",
            "Workshop facilitation",
            "Assessment and roadmap development",
            "Pilot program design",
          ]) +
          p("Engagements are tailored to client culture and constraints, delivering right-sized solutions."),
      },
      {
        slug: "how-long-do-typical-engagements-last",
        question: "How long do typical Synozur engagements last?",
        answer: p("Engagement length varies based on client needs and service type. Strategic transformation and Company OS implementations may span several months to establish frameworks and rhythms. AI strategy projects typically target 12&ndash;18 month timelines from assessment to pilot implementation. Fractional leadership can be ongoing."),
      },
      {
        slug: "how-can-i-get-started-with-synozur",
        question: "How can I get started with Synozur?",
        answer: p("Organizations can get started by visiting <a href=\"https://www.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">synozur.com</a> and contacting Synozur for a complimentary strategy consultation. For Vega, visit <a href=\"https://vega.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">vega.synozur.com</a>. For Orion assessments, visit <a href=\"https://orion.synozur.com\" target=\"_blank\" rel=\"noopener noreferrer\">orion.synozur.com</a> to complete your maturity evaluation."),
      },
    ],
  },

  {
    slug: "recognition-partnerships",
    name: "Recognition & Partnerships",
    description: "Microsoft partnership, certifications, growth milestones, and the Polaris podcast.",
    order: 90,
    items: [
      {
        slug: "is-synozur-a-microsoft-partner",
        question: "Is Synozur a Microsoft partner?",
        answer: p("Yes, Synozur is a Microsoft Solutions Partner. In 2024, Synozur was recognized as a Preferred Microsoft Content AI Partner, affirming its deep expertise in Microsoft 365 and AI-powered content services. This strategic partnership gives clients a competitive edge through advanced knowledge of Microsoft capabilities and alignment with Microsoft&rsquo;s go-to-market programs."),
      },
      {
        slug: "what-recognition-has-synozur-received",
        question: "What recognition has Synozur received?",
        answer: p("Synozur was founded in 2023 and achieved Microsoft Preferred Content AI Partner status in 2024. By 2025, Synozur doubled its online engagement and grew its pipeline by over 500% driven by targeted campaigns and partner enablement programs. The company has led transformation programs across communications, professional services, and public sector industries."),
      },
      {
        slug: "what-is-the-polaris-podcast",
        question: "What is Synozur's Polaris podcast?",
        answer: p("Polaris is Synozur&rsquo;s podcast launched in mid-2024 as part of go-to-market acceleration efforts. The podcast features discussions on business strategy, AI transformation, leadership, and digital workplace topics, including episodes with industry leaders and Synozur experts."),
      },
    ],
  },

  {
    slug: "who-we-help",
    name: "Who We Help",
    description: "Clients, industries, and the organizations Synozur serves.",
    order: 100,
    items: [
      {
        slug: "what-types-of-clients-does-synozur-work-with",
        question: "What types of clients does Synozur typically work with?",
        answer: p("Synozur partners with midmarket companies, Microsoft partners, private equity firms, tribal nations, and large enterprises to drive strategic transformation, AI adoption, and go-to-market acceleration. Our clients span industries such as professional services, public sector, retail, manufacturing, and communications."),
      },
      {
        slug: "how-does-synozur-support-midmarket-organizations",
        question: "How does Synozur support midmarket organizations?",
        answer: p("We specialize in helping midmarket businesses scale with confidence by implementing Company Operating Systems, aligning leadership teams, and embedding strategic rhythms like OKRs and quarterly planning. Our tailored approach ensures that transformation is right-sized and outcome-driven."),
      },
      {
        slug: "services-for-private-equity-firms",
        question: "What services does Synozur offer to private equity firms?",
        answer: p("Synozur works with private equity leaders to assess AI readiness across portfolio companies, develop tailored AI roadmaps, and implement scalable pilots that deliver measurable ROI. We help unlock value through responsible AI adoption, governance frameworks, and Microsoft ecosystem alignment."),
      },
      {
        slug: "how-does-synozur-help-tribal-enterprises",
        question: "How does Synozur help Native American tribes and tribal enterprises?",
        answer: p("We collaborate with tribal governments and casino revenue tribes to modernize operations, improve member services, and implement ethical AI and digital transformation strategies. Our approach is culturally sensitive, people-centric, and aligned with tribal sovereignty and values."),
      },
      {
        slug: "value-synozur-brings-to-microsoft-partners",
        question: "What value does Synozur bring to Microsoft partners?",
        answer: p("As a Microsoft Solutions Partner, Synozur helps ISVs and systems integrators align with Microsoft&rsquo;s go-to-market strategy, unlock co-sell opportunities, and accelerate growth. We provide partner development, channel enablement, and strategic messaging tailored to Microsoft&rsquo;s ecosystem."),
      },
      {
        slug: "does-synozur-work-with-large-enterprises",
        question: "Does Synozur work with large enterprises like Microsoft and Oxy?",
        answer: p("Yes. Synozur has supported enterprise clients including Microsoft and Oxy with strategic transformation, AI design, and go-to-market innovation. Our team of Fortune 500 alumni brings deep experience navigating complex, matrixed organizations and delivering measurable outcomes at scale."),
      },
    ],
  },
];

async function main() {
  console.log("Clearing existing FAQ data…");
  await db.delete(faqItemsTable);
  await db.delete(faqCategoriesTable);

  let totalItems = 0;

  for (const cat of CATEGORIES) {
    console.log(`  → ${cat.name} (${cat.items.length} questions)`);
    const [inserted] = await db
      .insert(faqCategoriesTable)
      .values({
        slug: cat.slug,
        // #108: artifact-pattern title mirrors the domain-facing `name`.
        title: cat.name,
        name: cat.name,
        description: cat.description,
        displayOrder: cat.order,
        status: "published",
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning({ id: faqCategoriesTable.id });

    const categoryId = inserted!.id;

    for (let i = 0; i < cat.items.length; i++) {
      const item = cat.items[i]!;
      await db.insert(faqItemsTable).values({
        categoryId,
        slug: item.slug,
        title: item.question,
        question: item.question,
        answerHtml: item.answer,
        displayOrder: (i + 1) * 10,
        status: "published",
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      totalItems++;
    }
  }

  console.log(`\nDone — ${CATEGORIES.length} categories, ${totalItems} questions.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
