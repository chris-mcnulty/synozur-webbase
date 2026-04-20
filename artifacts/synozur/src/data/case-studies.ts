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
    heroImage: "/images/case-studies/microsoft.jpg",
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
    heroImage: "/images/case-studies/luxury.jpg",
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
    heroImage: "/images/case-studies/energy.jpg",
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
    slug: "ai-and-knowledge-transformation-at-a-strategic-communications-firm",
    title: "AI and Knowledge Transformation at a Strategic Communications Firm",
    client: "North American Communications Agency",
    clientLabel: "North American Communications Agency",
    industry: "Professional Services",
    established: "2019",
    tag: "AI",
    headline: "A fast‑growing strategic communications firm partnered with Synozur to define an AI strategy and modernize …",
    summary:
      "A fast‑growing strategic communications firm partnered with Synozur to define an AI strategy and modernize knowledge workflows—without disrupting creative teams or compromising trust with clients. The goal was not AI for AI’s sake, but a people‑first approach that made work easier, faster, and more consistent.",
    heroImage: "/images/case-studies/strategic-comms.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "As the firm scaled, leaders saw increasing friction across content creation, research, and internal knowledge sharing. Teams were spending too much time searching for information, recreating work, and navigating disconnected tools. At the same time, leadership wanted to explore AI—but responsibly, with clear governance and adoption in mind.",
        "The firm recognized that long‑term growth depended on enabling its people with better tools, clearer guidance, and shared confidence in how AI would be used across the organization.",
        "Operating in a high‑trust, client‑facing environment, the organization needed to balance innovation with credibility, governance, and cultural fit.",
        "Create a clear, business‑aligned AI strategy while strengthening knowledge management and collaboration—ensuring AI enhanced human expertise rather than replacing it.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [
          "Synozur began by listening—working closely with firm leadership to understand how people actually worked day to day. We then guided the organization through an AI Academy experience, paired with a Microsoft 365 enablement strategy, focused on real workflows and real outcomes.",
          "Our work included:",
          "Throughout the engagement, we emphasized a human‑centric, tailored approach, ensuring every recommendation fit the firm’s culture and pace.",
        ],
        bullets: [
          "Establishing an AI governance model aligned to firm values and client trust",
          "Designing practical AI use cases for research, drafting, and knowledge discovery",
          "Modernizing collaboration and knowledge management using Microsoft 365",
          "Building confidence and adoption through targeted training and leadership alignment",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "With a clear strategy and trusted governance in place, the firm is now positioned to innovate responsibly—using AI to enhance creativity, not compromise it.",
      ],
      bullets: [
        "Clear AI strategy grounded in real business needs",
        "Improved knowledge sharing and reduced duplicate work",
        "Increased team confidence using AI responsibly",
        "A scalable foundation for continued innovation",
      ],
    },
    metrics: [
    ],
    quote: {
      text: "Synozur helped us move past the hype and focus on what actually matters—our people, our work, and our clients. AI now feels like a support system, not a distraction.",
      attribution: "Senior Partner",
    },
  },
  {
    slug: "ai-transformation-at-a-private-equity-portfolio-company",
    title: "AI Transformation at a Private Equity Portfolio Company",
    client: "Financial Services",
    clientLabel: "Financial Services",
    industry: "Private Equity",
    established: "1998",
    tag: "Technology",
    headline: "40% measured improvement",
    summary:
      "A financial‑services portfolio company of a leading private equity firm engaged Synozur to shift from scattered AI experiments to governed, measurable outcomes at enterprise scale. Building on patterns we’ve proven in similar programs, we turned real documents and workflows into a prioritized use‑case backlog, stood up a practical governance model, and upskilled leaders and makers through a multi‑tool curriculum. At‑a‑glance The challenge: Pilots in silos, uneven skills, unclear guardrails, hard‑to‑measure value. What we did: Converted authentic scenarios into high‑value use cases; launched role‑based skilling; operationalized governance for safe, compliant adoption. Why it worked: Real work > demo theater, with measurable outcomes, reusable prompt libraries, and oversight rituals embedded in day‑to‑day operations. Early impact: Faster time from idea to production, higher adoption across business lines, and increased confidence from risk/legal/security.",
    heroImage: "/images/case-studies/pe-portfolio.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "A financial services portfolio company of a leading private equity firm faced a familiar challenge: AI pilots were scattered across teams, with no clear governance, skilling strategy, or roadmap for scaling. While leadership recognized AI’s potential, the organization lacked a unified approach to turn experimentation into measurable enterprise value.",
        "Synozur helped a private equity portfolio company in financial services move from fragmented AI pilots to a governed, enterprise-wide adoption program—drawing on proven strategies from our prior engagements.",
        "Synozur was engaged to design and deliver a comprehensive AI adoption program. Drawing on lessons from prior engagements, we combined deep industry knowledge with proven enablement strategies to accelerate adoption while mitigating risk.",
        "The company needed to:",
      ],
      bullets: [
        "Identify and prioritize high-value AI use cases grounded in real business scenarios.",
        "Build a governance framework to ensure safe, compliant, and consistent AI adoption.",
        "Equip employees—from executives to frontline staff—with the skills and confidence to use AI effectively.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [
          "Our approach unfolded in three integrated phases:",
          "Discovery",
          "Development",
          "Deployment",
        ],
        bullets: [
          "Conducted workshops with leadership and operational teams to surface authentic scenarios and documentation (claims notes, customer communications, policy language).",
          "Assessed organizational readiness and risk posture to inform governance design.",
          "Built a prioritized use-case backlog mapped to business outcomes.",
          "Designed a role-based skilling program for executives, managers, and makers, incorporating hands-on labs and oversight prompts.",
          "Established governance guardrails for data security, compliance, and responsible AI use.",
          "Delivered a multi-tool curriculum spanning productivity copilots, research assistants, and low-code automation platforms.",
          "Embedded reusable prompt libraries, safe-use checklists, and oversight frameworks into daily workflows.",
          "Facilitated adoption metrics and ROI tracking to sustain momentum.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "Estimated $250K–$500K annual cost savings and $500K–$1.0M+ EBITDA uplift, driven by faster decision‑making, reduced duplicated analysis, and improved execution discipline across leadership and operations.",
        "This engagement proved that sustainable AI value comes from three disciplines, executed together: authentic use cases, a right‑sized governance framework, and an inclusive, role‑based skilling program. By grounding AI in the client’s actual documents and processes—and giving teams the tools, language, and checks to use it responsibly—we moved beyond pilots to durable capabilities the organization now owns.",
        "What endures",
        "What’s next",
      ],
      bullets: [
        "Accelerated Adoption: Reduced time from pilot to production by 40%, with measurable gains in claims processing and customer communication workflows.",
        "Governed Scale: Implemented a governance model that satisfied risk, legal, and compliance teams while enabling innovation.",
        "Enterprise Skilling: Over 80% of targeted roles completed AI fluency training, creating a culture of confident, responsible AI use.",
      ],
    },
    metrics: [
      { label: "measured improvement", value: "40%" },
      { label: "measured improvement", value: "80%" },
    ],
    quote: {
      text: "This wasn’t just training - it was transformation. Synozur helped us turn real work into real results, giving our teams the tools, skills, and guardrails to make AI part of our DNA.",
      attribution: "Chief Operating Officer",
    },
  },
  {
    slug: "accelerating-go-to-market-for-a-leading-ai-isv",
    title: "Accelerating Go-To-Market for a leading AI ISV",
    client: "Leading AI ISV",
    clientLabel: "Leading AI ISV",
    industry: "Software",
    established: "2004",
    tag: "Fractional CxO",
    headline: "Our client, a leading independent software vendor (ISV), developed an app for generative AI systems like Mi…",
    summary:
      "Our client, a leading independent software vendor (ISV), developed an app for generative AI systems like Microsoft Copilot to integrate disconnected content. Synozur was engaged for fractional product and marketing leadership to drive mew messaging, new app designs, and strategic go-to-market plans, recruiting sales leaders and mentoring staff to drive a successful product launch.",
    heroImage: "/images/case-studies/ai-isv.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "Our client, a leading independent software vendor (ISV), had developed a revolutionary app to integrate multiple data sources for generative AI systems like Copilot. For AI, content can be spread across disconnected silos, with inconsistent content quality, and difficulties in ensuring accessibility and compliance. Their product connects dozens of business content systems; catalogs all content in a central app to manage, classify, and secure content; and publishes approved content to selected AI applications like Microsoft Copilot.",
        "Synozur was engaged for fractional leadership and marketing to address their product development and go to market strategies.",
        "Our client needed to introduce their AI integration product within a compressed timeline, facing challenges in managing and securing disparate content sources. They required strategic leadership in product development and marketing to effectively position and launch their revolutionary app in the competitive market.",
        "The client faced challenges in launching their generative AI integration app due to a compressed timeline and the need to explain the product quickly. They needed strategic leadership and marketing expertise to effectively introduce their product to the market and ensure accessibility and compliance.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [
          "Synozur established a comprehensive Messaging and Positioning Framework (MPF). A Messaging and Positioning Framework (MPF) is a strategic tool used to articulate and communicate the key messages and value propositions of a product or service. It ensures that all stakeholders, including employees, partners, and customers, have a consistent and clear understanding of what the product offers, how it differentiates from competitors, and the benefits it delivers.",
          "We undertook an in-depth analysis of the ISV’s product, market, competition, and target audience. We conducted a series of interviews with key stakeholders, including the client's leadership team, product managers, and sales representatives.",
          "In addition, Synozur facilitated workshops to test and develop product names and messaging concepts that brought together cross-functional teams from the client organization. These workshops served as collaborative sessions to brainstorm, refine, and validate the key messages and positioning statements. The outcome of this rigorous process was a well-defined Messaging and Positioning Framework that guided the creation of marketing materials, sales pitches, and customer communications, ensuring that the product was introduced and explained to customers in a clear, compelling, and consistent manner.",
          "Synozur also designed a conceptual app user experience that streamlined the process of gathering, securing, enriching, and preparing content from multiple external data sources. This unified app aimed to provide a seamless and intuitive experience for users, enabling them to leverage AI-driven insights and drive smarter, faster, and more innovative operations.",
          "Finally, Synozur developed a strategic go-to-market plan. We played a crucial role in recruiting sales leaders and mentoring sales and marketing staff, as well as developing early-stage customer prospects. Our efforts included developing blog posts, web content and press releases, working on the pricing model and channel strategy, and ensuring the client's readiness for the market launch.",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "As a result, the client was able to announce their product on schedule, and promote it at major industry events. They’ve been able to drive customer awareness and intent while amplifying investment interest in their firm. Most importantly, they acheived an estimated $0.8M–$1.2M incremental revenue over 12–24 months and $250K–$500K in cost avoidance, enabled by accelerated go‑to‑market execution, clearer positioning, and higher early‑stage conversion.",
        "This project exemplifies our commitment to helping clients define and introduce new products to the market through innovative solutions and strategic collaboration.",
      ],
    },
    metrics: [
    ],
    quote: {
      text: "Our partnership has been instrumental in transforming our AI go-to-market. We’re able to clearly communicate and deliver value to our customers and drive new revenue streams.",
      attribution: "CEO, Leading AI ISV",
    },
  },
  {
    slug: "ai-&-governance-acceleration-for-private-equity",
    title: "AI & Governance Acceleration for Private Equity",
    client: "US Private Equity",
    clientLabel: "US Private Equity",
    industry: "Finance",
    established: "1995",
    tag: "AI",
    headline: "A private equity firm partnered with Synozur to rapidly accelerate AI readiness while strengthening governa…",
    summary:
      "A private equity firm partnered with Synozur to rapidly accelerate AI readiness while strengthening governance, security, and executive alignment.",
    heroImage: "/images/case-studies/pe-governance.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "AI opportunities were emerging across the business, but without coordination risked fragmentation, duplication, and governance gaps.",
        "Speed mattered—but so did discipline. Leadership needed momentum without sacrificing control.",
        "In a PE environment, initiatives must show progress quickly while maintaining governance, security, and operational rigor.",
        "Enable fast, responsible AI progress with clear leadership ownership and measurable outcomes aligned to enterprise value creation.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [
          "Synozur designed and guided a 12‑week AI readiness and governance program, working alongside executive leadership.",
          "Our work included:",
        ],
        bullets: [
          "Establishing an executive AI steering committee for M365 Copilot and ChatGPT Enterprise",
          "AI and Microsoft 365 maturity assessments",
          "Development of a go-forward content governance, security and compliance program with Microsoft Purview",
          "Prioritized AI use‑case identification",
          "Sprint‑based roadmap with checkpoints and metrics",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "The company now treats AI as a strategic asset—guided by leadership, governed with intent, and aligned to long‑term value.",
      ],
      bullets: [
        "Stronger governance and executive alignment",
        "Improved readiness to scale AI responsibly",
        "Faster, more confident decision‑making",
        "Repeatable framework for future innovation",
      ],
    },
    metrics: [
    ],
    quote: {
      text: "“Synozur helped us move quickly without losing control. We gained clarity, structure, and confidence—exactly what we needed.”",
      attribution: "Technology Operating Partner",
    },
  },
  {
    slug: "executive-ai-readiness-at-a-leading-education-technology-company",
    title: "Executive AI Readiness at a Leading Education Technology Company",
    client: "North American Education Technology Company",
    clientLabel: "North American Education Technology Company",
    industry: "Education Technology",
    established: "1969",
    tag: "AI",
    headline: "A leading education technology organization partnered with Synozur to assess AI readiness, align leadership…",
    summary:
      "A leading education technology organization partnered with Synozur to assess AI readiness, align leadership, and define a practical roadmap for responsible AI adoption.",
    heroImage: "/images/case-studies/edtech.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "While leadership understood AI’s potential, conversations lacked a shared baseline. Without clarity on readiness, skills, and priorities, momentum was difficult to sustain.",
        "The organization sought clarity before action—ensuring AI investments would support learners, educators, and operational excellence.",
        "Operating in a mission‑driven, outcomes‑focused environment, leaders needed confidence that AI decisions would align with both values and impact.",
        "Create executive alignment around AI, establish a readiness baseline, and define next steps grounded in educational outcomes—not experimentation.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [
          "Synozur delivered an AI Academy for executive leadership, paired with an Orion‑based AI readiness assessment to establish a shared understanding and fact‑based roadmap.",
          "Our work included:",
        ],
        bullets: [
          "Executive education tailored to education‑sector realities",
          "AI readiness assessment across leadership roles",
          "Facilitated prioritization of high‑impact, low‑risk use cases",
          "A phased roadmap aligned to learning and operational goals",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "With clarity and alignment in place, the organization is positioned to adopt AI thoughtfully—guided by outcomes, not uncertainty.",
      ],
      bullets: [
        "Shared executive language and alignment around AI",
        "Clear understanding of organizational readiness",
        "Prioritized roadmap for responsible AI adoption",
        "Increased confidence to move forward with purpose",
      ],
    },
    metrics: [
    ],
    quote: {
      text: "“Synozur gave our leadership team clarity. We now have a common understanding of what AI can—and should—do for our organization.”",
      attribution: "Executive Leader",
    },
  },
  {
    slug: "story-cellars",
    title: "Story Cellars and Synozur - Craft and Culture",
    client: "Story Cellars",
    clientLabel: "Story Cellars",
    industry: "Consumer Products",
    established: "2016",
    tag: "Marketing",
    headline: "Story Cellars was founded in 2016 by Tim Oas.",
    summary:
      "Story Cellars was founded in 2016 by Tim Oas. Tim is a pioneer in crafting Washington state wines from their winery in Woodinville, Washington. We chose to partner with Story Cellars because we believe in Tim and love his approach to winemaking. The Velvet Vega Zin has been a labor of love for Tim and a great partnership for us.",
    heroImage: "/images/case-studies/story-cellars.png",
    challenge: {
      heading: "The challenge",
      body: [
        "A main theme for Synozur is collaboration - and who doesn’t love a good collaboration, right? We're proud to have a great partnership with Tim Oas and Story Cellars.",
        "If you were at his shop, Tim would tell you about the ancient zinfandel vines he nurtured to produce this fabulous vino.",
        "There are two things Tim says are the keys to success, being Unique and Determined! We at Synozur couldn’t agree more.",
        "We chose to partner with Story Cellars because we believe in Tim and love his approach to winemaking. The Velvet Vega Zin has been a labor of love for Tim and a great partnership for us.",
        "If you were at his shop, he would tell you about the ancient zinfandel vines he nurtured to produce this fabulous vino.",
        "There are two things Tim says are the keys to success, being Unique and Determined! We at Synozur couldn’t agree more.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "Thank you for your valued partnership with us on your journey to transform your workplace and achieve your North Star vision.",
      ],
    },
    metrics: [
    ],
    quote: {
      text: "Our partnership with Synozur continues to open up new ways of thinking and developing oiur customer relationships.",
      attribution: "Tim Oas, Owner and Winemaker",
    },
  },
  {
    slug: "go‑to‑market-transformation-for-a-microsoft‑aligned-software-company",
    title: "Go‑to‑Market Transformation for a Microsoft‑Aligned Software Company",
    client: "US Enterprise Software Company",
    clientLabel: "US Enterprise Software Company",
    industry: "Enterprise Software",
    established: "2005",
    tag: "Marketing",
    headline: "A Microsoft‑aligned software company partnered with Synozur to clarify its go‑to‑market strategy, sharpen m…",
    summary:
      "A Microsoft‑aligned software company partnered with Synozur to clarify its go‑to‑market strategy, sharpen messaging, align to Microsoft, and strengthen partner engagement.",
    heroImage: "/images/case-studies/msft-aligned-sw.jpg",
    challenge: {
      heading: "The challenge",
      body: [
        "Despite a strong product, messaging lacked focus and partner engagement was inconsistent—limiting momentum in a competitive market.",
        "Leadership recognized that growth required clarity—not more activity.",
        "Operating inside the Microsoft ecosystem, alignment and relevance were critical to sales and partner success.",
        "Create clear positioning, align to Microsoft sales motions, and establish a repeatable GTM rhythm.",
      ],
    },
    approach: [
      {
        heading: "Our approach",
        body: [
          "Synozur led a Go‑to‑Market Workshop, acting as both strategist and proxy customer.",
          "Our work included:",
        ],
        bullets: [
          "Messaging and positioning refinement",
          "Alignment to Microsoft priorities and motions",
          "Partner enablement strategy design",
          "Sales and leadership coaching",
          "Market research and focus group development",
          "Brand strategy and development",
        ],
      },
    ],
    outcome: {
      heading: "The outcome",
      body: [
        "With a focused GTM strategy in place, the company is positioned for sustained growth and stronger ecosystem impact.",
      ],
      bullets: [
        "Clearer market positioning",
        "Stronger Microsoft partner alignment",
        "Improved sales confidence and consistency",
        "Increased partner‑sourced pipeline",
      ],
    },
    metrics: [
    ],
    quote: {
      text: "“Synozur helped us tell a clearer story—one that resonates with customers and partners alike.”",
      attribution: "Chief Revenue Officer",
    },
  },
];

export function getCaseStudyBySlug(slug: string): CaseStudy | undefined {
  return caseStudies.find((cs) => cs.slug === slug);
}
