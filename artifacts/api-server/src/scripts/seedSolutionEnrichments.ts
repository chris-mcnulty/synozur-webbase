/**
 * Idempotent seed — enriches solution pages with a product / accelerators
 * callout (where relevant) and a solution-specific FAQ. The callout
 * highlights whichever Synozur product is the natural accelerator for that
 * practice — Zenith (M365 governance) for the M365-stack solutions, Vega
 * (the Company Operating System) for Company OS.
 *
 * Solutions with a Zenith callout AND an FAQ:
 *   - Microsoft Partner Development  (slug: microsoft-partner-development)
 *   - AI Strategy and Design         (slug: ai-strategy-and-design)
 *   - Employee Effectiveness         (slug: employee-effectiveness)
 *   - Employee Strategies            (slug: employee-strategies)
 *
 * Solutions with a Vega callout AND an FAQ:
 *   - Company OS                     (slug: company-os)
 *
 * Solutions with FAQ-only enrichment (no product callout — these practices
 * don't sit on the Microsoft 365 stack, but each page still benefits from
 * answering the questions buyers actually ask):
 *   - Brand and Messaging            (slug: brand-and-messaging)
 *   - Design Strategies              (slug: design-strategies)
 *   - Fractional Leadership          (slug: fractional-leadership)
 *   - GTM Strategy and Execution     (slug: gtm-strategy-and-execution)
 *   - Strategic Roadmaps             (slug: strategic-roadmaps)
 *   - Communication Strategies       (slug: communication-strategies)
 *   - Delivery Management            (slug: delivery-management)
 *
 * For FAQ-only enrichments acceleratorsHtml is left untouched (null/empty)
 * so the page renders the FAQ block without an out-of-place tool callout.
 *
 * These solutions already exist in the database (seeded by ingestServices.ts).
 * This script only updates the acceleratorsHtml and faqHtml columns; all other
 * content fields are left untouched.
 *
 * Safe to re-run: each update is a targeted SET on a known slug. If the slug
 * is not found the script logs a warning and continues.
 *
 *   pnpm --filter api-server exec tsx src/scripts/seedSolutionEnrichments.ts
 */

import { eq } from "drizzle-orm";
import { db, pool, solutionsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// HTML content helpers
// ---------------------------------------------------------------------------

function p(...lines: string[]): string {
  return lines.map((l) => `<p>${l}</p>`).join("\n");
}

// `ul()` was a stale helper for an earlier seed shape; current seeds emit
// list HTML inline. Removed.

// ---------------------------------------------------------------------------
// Microsoft Partner Development — content
// ---------------------------------------------------------------------------

const PARTNER_ACCELERATORS_HTML = [
  p(
    "<strong><a href=\"https://zenith.synozur.com\">Zenith</a></strong> is Synozur\u2019s Microsoft 365 Governance Command Center\u2014and a purpose-built asset for Microsoft Partners looking to differentiate their M365 practice.",
  ),
  p(
    "Partners who bring Zenith into a client engagement get an instant, data-driven picture of workspace health, governance policy alignment, and Copilot readiness across the entire tenant. That visibility shortens discovery, makes recommendations concrete, and gives clients a compelling reason to act. Partners can also position Zenith as an ongoing value-add that keeps governance from drifting after the engagement closes.",
  ),
  p(
    "Zenith integrates with Microsoft Entra ID for tenant-isolated authentication and surfaces governance decisions directly in SharePoint\u2014making it a natural fit for partners already working in the Microsoft stack.",
  ),
].join("\n");

const PARTNER_FAQ_HTML = [
  p("<strong>Can we offer Zenith directly to our clients as part of an M365 engagement?</strong>"),
  p(
    "Yes. Synozur works with Microsoft Partners to position Zenith as a governance layer within existing M365 practices. Whether you\u2019re running an adoption workshop, a Copilot readiness assessment, or a post-deployment governance review, Zenith can slot into the engagement as a client-facing deliverable or an ongoing subscription.",
  ),
  p("<strong>How does Zenith help us win Microsoft deals?</strong>"),
  p(
    "Zenith gives you evidence before you recommend anything\u2014workspace health scores, governance policy gaps, Copilot readiness ratings\u2014that make your proposals more credible and easier to approve. Clients can see their actual posture rather than accepting a consultant\u2019s assertion. That transparency shortens sales cycles and increases close rates on governance-adjacent work.",
  ),
  p("<strong>Does Zenith compete with any Microsoft-native tooling?</strong>"),
  p(
    "No. Zenith complements the Microsoft stack rather than replacing it. It surfaces signals from Entra ID, SharePoint, and Purview in a single pane of glass, correlates them against your governance policies, and prioritizes remediation\u2014work that Microsoft\u2019s native reporting does not do automatically. Purview enforces the policies Zenith helps you design.",
  ),
  p("<strong>What does Synozur provide to partners implementing Zenith?</strong>"),
  p(
    "We provide onboarding support, technical documentation, and partner-facing guidance on how to frame Zenith within an M365 practice. Reach out through your Synozur contact or the partner inquiry form to discuss specifics.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// AI Strategy and Design — content
// ---------------------------------------------------------------------------

const AI_ACCELERATORS_HTML = [
  p(
    "<strong><a href=\"https://zenith.synozur.com\">Zenith</a></strong> is Synozur\u2019s Microsoft 365 Governance Command Center, and it plays a direct role in AI readiness\u2014particularly for organizations deploying Microsoft Copilot.",
  ),
  p(
    "Copilot grounds its responses in your existing Microsoft 365 content. That means the accuracy, trustworthiness, and compliance of AI outputs depend entirely on the quality of your information architecture, sensitivity labels, and sharing posture. Zenith evaluates every workspace in your tenant against those criteria and surfaces the highest-priority remediation actions before you turn Copilot on\u2014so AI adoption builds confidence rather than exposing risk.",
  ),
  p(
    "For clients pursuing a broader AI strategy, Zenith provides the continuous governance signal needed to keep your M365 environment AI-ready as content and collaboration patterns evolve.",
  ),
].join("\n");

const AI_FAQ_HTML = [
  p("<strong>Do we need to resolve governance issues before deploying Copilot?</strong>"),
  p(
    "Not necessarily before\u2014but ideally in parallel. Copilot surfaces whatever content exists in your tenant, including outdated, mis-labeled, or over-shared files. Addressing the highest-risk gaps before broad rollout prevents Copilot from undermining trust on day one. Zenith helps you identify and prioritize those gaps quickly so you\u2019re not delaying deployment indefinitely.",
  ),
  p("<strong>What does Zenith tell us about our AI readiness specifically?</strong>"),
  p(
    "Zenith scores every workspace against a Copilot readiness rubric that covers sensitivity labels, external sharing configuration, content ownership, and policy alignment. It surfaces workspaces with the greatest compliance risk and recommends the remediation actions with the highest expected impact. The result is a prioritized action list rather than a sprawling audit report.",
  ),
  p("<strong>How long does Copilot readiness preparation take?</strong>"),
  p(
    "A targeted Copilot readiness sprint typically runs three to four weeks: one week to assess posture using Zenith, one to two weeks to remediate the highest-priority issues, and one week to validate the changes and establish a governance baseline for ongoing monitoring. Larger or more complex tenants may need additional time.",
  ),
  p("<strong>Will Zenith continue to monitor our governance posture after Copilot is deployed?</strong>"),
  p(
    "Yes. Governance drift is real\u2014new workspaces, new owners, and changing sharing patterns can erode the baseline you establish at launch. Zenith provides continuous visibility so your team can catch and correct issues before they affect Copilot outputs or create compliance exposure.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// Employee Effectiveness — content
// ---------------------------------------------------------------------------

const EMPLOYEE_ACCELERATORS_HTML = [
  p(
    "<strong><a href=\"https://zenith.synozur.com\">Zenith</a></strong> is Synozur\u2019s Microsoft 365 Governance Command Center, and it supports employee effectiveness by ensuring that the collaboration tools employees depend on are well-configured, findable, and governed.",
  ),
  p(
    "When SharePoint, Teams, and OneDrive are poorly governed\u2014with sprawling workspaces, inconsistent naming, and unclear ownership\u2014employees lose time searching for content, duplicate work, and route around official channels. Zenith surfaces those friction points and prioritizes the governance fixes that have the greatest impact on day-to-day effectiveness. It also monitors workspace health continuously, so improvements don\u2019t erode over time as teams and content grow.",
  ),
].join("\n");

const EMPLOYEE_FAQ_HTML = [
  p("<strong>How does poor M365 governance affect employee productivity?</strong>"),
  p(
    "Governance problems become employee experience problems. When workspaces are unnamed or misconfigured, when external sharing is inconsistent, or when there\u2019s no clear \u201csource of truth\u201d for a given project or team, employees spend time navigating friction instead of doing work. Surveys consistently show that findability and information overload are top sources of employee frustration in Microsoft 365 environments.",
  ),
  p("<strong>Can we use Zenith without a broader M365 adoption engagement?</strong>"),
  p(
    "Yes. Zenith can be deployed as a standalone governance monitoring tool. That said, the most impactful results come when Zenith\u2019s findings are connected to an adoption or governance program that acts on them\u2014otherwise the visibility doesn\u2019t translate into improvement. We can help you scope a lightweight engagement to get both.",
  ),
  p("<strong>What does Zenith show us about how employees are using M365 today?</strong>"),
  p(
    "Zenith evaluates workspace health across your entire tenant\u2014looking at governance policy adherence, Copilot readiness, sharing posture, and ownership. While it isn\u2019t a usage analytics tool, it identifies the structural issues that make it harder for employees to collaborate effectively and surfaces the remediation steps most likely to reduce friction.",
  ),
  p("<strong>How does Zenith help our IT team manage governance at scale?</strong>"),
  p(
    "Zenith gives IT a unified view of governance health across all workspaces\u2014without requiring manual audits. It maps workspaces to your governance policies, flags violations, and recommends prioritized actions. That means IT can shift from reactive \u201cgovernance firefighting\u201d to proactive maintenance, and can demonstrate governance posture to leadership in a format that doesn\u2019t require a deep Microsoft 365 background to interpret.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// Company OS — content
// ---------------------------------------------------------------------------

const COMPANY_OS_ACCELERATORS_HTML = [
  p(
    "<strong><a href=\"https://vega.synozur.com\">Vega</a></strong> is Synozur\u2019s AI-augmented Company Operating System\u2014the accelerator that turns a Company OS engagement from a set of decisions into a running operating rhythm.",
  ),
  p(
    "A Company OS only delivers if strategy stays connected to daily execution. Vega unifies mission, priorities, OKRs, and meetings into a single cadence so the operating model is something the organization runs every week\u2014not a document that goes stale. The Vega Launchpad can generate a tailored Company OS directly from your existing mission, values, and strategy documents, so engagements start with a working system instead of a blank page.",
  ),
  p(
    "As the organization grows, Vega keeps clarity, cadence, and accountability intact\u2014with an AI assistant that helps leaders maintain alignment and surface where execution is drifting from intent.",
  ),
].join("\n");

const COMPANY_OS_FAQ_HTML = [
  p("<strong>How does Vega fit into a Company OS engagement?</strong>"),
  p(
    "Company OS defines how the business runs\u2014mission, priorities, rituals, ownership, and accountability. Vega is where that operating model actually lives and runs: it unifies mission, OKRs, and meetings into one cadence so the model stays active rather than becoming a static artifact. It\u2019s not required to begin a Company OS engagement, but it\u2019s how most clients keep the operating system running after the engagement ends.",
  ),
  p("<strong>Can we stand up a Company OS quickly with Vega?</strong>"),
  p(
    "Yes. The Vega Launchpad generates a tailored Company OS from your existing organizational documents\u2014importing mission, values, and strategic elements\u2014so you start from a working draft rather than a blank template. That shortens setup considerably and lets the engagement focus on refinement and adoption instead of initial assembly.",
  ),
  p("<strong>How does Vega keep strategy connected to daily execution?</strong>"),
  p(
    "Vega brings mission, priorities, OKRs, and the meeting rhythm into a single operating cadence, with hierarchy, weighting, and rollups so progress is visible at every level. Its AI assistant helps leaders see where execution is diverging from intent and prompts the conversations that keep the organization aligned week to week.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// Employee Strategies — content
// ---------------------------------------------------------------------------

const EMPLOYEE_STRATEGIES_ACCELERATORS_HTML = [
  p(
    "<strong><a href=\"https://zenith.synozur.com\">Zenith</a></strong> is Synozur\u2019s Microsoft 365 Governance Command Center. While Employee Strategies is fundamentally a people-and-culture practice, Zenith plays a supporting role when the strategy depends on Microsoft 365 as the day-to-day work environment.",
  ),
  p(
    "Employee experience strategies often run aground on the same issue: the digital environment doesn\u2019t match the experience leadership describes. When Teams, SharePoint, and OneDrive are noisy, fragmented, or inconsistently governed, employees feel friction regardless of how strong the strategy is on paper. Zenith identifies the structural governance issues that quietly degrade the employee experience and prioritizes the fixes most likely to have the largest impact.",
  ),
].join("\n");

const EMPLOYEE_STRATEGIES_FAQ_HTML = [
  p(
    "<strong>How does M365 governance connect to employee strategy?</strong>",
  ),
  p(
    "Employees experience your strategy through the tools they use every day. If the digital workplace is hard to navigate\u2014too many duplicate workspaces, unclear ownership, inconsistent sharing\u2014every employee initiative has to fight that friction. Cleaning up the governance layer makes the rest of your employee strategy land more cleanly.",
  ),
  p(
    "<strong>Do we need to use Zenith as part of an Employee Strategies engagement?</strong>",
  ),
  p(
    "No. Employee Strategies engagements stand on their own and focus on operating model, leadership rhythms, and people practices. Zenith is relevant only when the engagement intersects with Microsoft 365\u2014for example, when leaders want to improve how employees collaborate, find information, or work with AI tools like Copilot. In those cases Zenith provides the governance evidence behind the recommendations.",
  ),
  p(
    "<strong>Can Zenith help us measure progress on employee experience initiatives?</strong>",
  ),
  p(
    "Zenith doesn\u2019t measure sentiment or engagement directly\u2014that comes from listening programs and qualitative feedback. What it does provide is a baseline and ongoing view of the structural conditions that make the digital workplace usable. Pairing Zenith\u2019s governance signal with the employee feedback you already collect gives a more complete picture of where to invest.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// FAQ-only enrichments (no Zenith callout — non-M365 practices)
// ---------------------------------------------------------------------------

const BRAND_FAQ_HTML = [
  p("<strong>How do you approach brand work without throwing out what we already have?</strong>"),
  p(
    "We start by auditing the assets, voice, and equity you\u2019ve already built and identifying what\u2019s working. Most engagements evolve a brand rather than replace it\u2014sharpening positioning, tightening the messaging hierarchy, and modernizing visual expression while preserving the recognition you\u2019ve earned. A full rebrand is reserved for situations where the existing brand actively misrepresents the business.",
  ),
  p("<strong>Do you deliver visual identity, messaging, or both?</strong>"),
  p(
    "Both, and they\u2019re developed together. Messaging without a visual system tends to drift in execution; a visual system without underlying messaging is decoration. Engagements typically produce a positioning statement, messaging hierarchy, voice and tone guidance, and the visual identity components (typography, color, imagery direction) needed to apply them consistently.",
  ),
  p("<strong>How do you make sure the brand actually gets used?</strong>"),
  p(
    "Brand assets only earn their cost when teams can apply them without a creative review on every artifact. We deliver enablement materials\u2014templates, examples, and quick-reference guidance\u2014so marketing, sales, and product teams can produce on-brand work independently. Where helpful, we run working sessions with the teams who will use the system day to day.",
  ),
  p("<strong>How long does a brand engagement take?</strong>"),
  p(
    "A focused positioning and messaging refresh runs four to six weeks. A broader engagement that includes visual identity work and enablement materials typically runs eight to twelve weeks depending on the number of stakeholder reviews and the breadth of channels involved.",
  ),
].join("\n");

const DESIGN_FAQ_HTML = [
  p("<strong>What kinds of design problems do you take on?</strong>"),
  p(
    "We work on design problems where strategy and craft intersect: information architecture for content-heavy products, design systems that make a growing team consistent, end-to-end flows for complex tasks, and the design language that ties marketing and product together. We\u2019re less suited to high-volume production design work where the brief is already settled.",
  ),
  p("<strong>Do you work alongside our in-house design team or replace it?</strong>"),
  p(
    "Alongside, in almost every case. Our highest-impact engagements augment an internal team with senior strategic capacity for a specific initiative\u2014launching a new product surface, rebuilding a key flow, or establishing a design system. We hand off cleanly so the internal team owns the work going forward.",
  ),
  p("<strong>How do you balance design quality with delivery timelines?</strong>"),
  p(
    "By scoping ruthlessly and shipping in slices. We identify the smallest design unit that proves the strategy, ship it, learn from real usage, and iterate. That keeps quality high where it matters and prevents the perfectionism cycle that tends to stall design work in larger organizations.",
  ),
  p("<strong>Will we get design files we can edit?</strong>"),
  p(
    "Yes. Source files, components, and tokens are delivered in the tool your team already uses (Figma in nearly every case). We document component behavior and usage so handoff to engineering is clean and the system is maintainable after the engagement closes.",
  ),
].join("\n");

const FRACTIONAL_FAQ_HTML = [
  p("<strong>What kinds of fractional roles do you take on?</strong>"),
  p(
    "We place experienced operators into fractional executive roles\u2014typically Chief of Staff, Head of Operations, Head of Strategy, or domain-specific leadership in product, marketing, or technology. Engagements run anywhere from one to three days a week depending on the cadence of the work, with clear deliverables and a defined endpoint.",
  ),
  p("<strong>How is this different from hiring a consultant?</strong>"),
  p(
    "A fractional leader operates inside the business: attending leadership meetings, owning outcomes, managing or mentoring people, and being accountable for a function. Consultants advise; fractional leaders run things. The arrangement is best suited to situations where the role is real but the workload doesn\u2019t yet justify a full-time hire, or where you need a known-quantity operator while you recruit.",
  ),
  p("<strong>How do we know when to transition out of a fractional arrangement?</strong>"),
  p(
    "We define exit criteria at the start of every engagement\u2014typically a combination of milestones (a function established, a system in place, a hire onboarded) and operating metrics. When those are met, we transition out cleanly, often after helping recruit and onboard the permanent hire who replaces us.",
  ),
  p("<strong>Will the same person stay with us throughout, or does it rotate?</strong>"),
  p(
    "The same person. Continuity is what makes fractional leadership work\u2014trust, context, and the ability to move quickly all depend on the same operator being in the room week after week. Synozur stands behind the engagement with peer review and backup capacity, but the lead is consistent.",
  ),
].join("\n");

const GTM_FAQ_HTML = [
  p("<strong>Where does GTM strategy work begin\u2014with the product, the customer, or the channels?</strong>"),
  p(
    "With the customer. A GTM motion that doesn\u2019t start from a clear-eyed view of the buyer\u2014who they are, what they\u2019re trying to accomplish, what they\u2019re willing to pay for, and how they make decisions\u2014ends up being a list of tactics in search of a story. We anchor every engagement in customer research first, then work backward to product positioning, channel mix, and operating cadence.",
  ),
  p("<strong>How do you handle GTM for a product that\u2019s new versus one that\u2019s already in market?</strong>"),
  p(
    "For new products the work focuses on positioning, ideal customer profile, and the smallest viable launch motion that produces evidence. For products already in market the work shifts to diagnosing where the funnel is leaking, sharpening segmentation, and reallocating spend to the channels that are actually producing pipeline. The methods overlap; the entry point is different.",
  ),
  p("<strong>Do you build the marketing and sales materials, or just the strategy?</strong>"),
  p(
    "Both, and they should be developed in lockstep. A strategy that doesn\u2019t produce concrete artifacts (positioning, sales narrative, demand-gen plan, enablement) tends to die in a slide deck. We deliver the strategy alongside the artifacts your team needs to act on it, then pair with marketing and sales leadership through the first execution cycle.",
  ),
  p("<strong>How do you measure whether the GTM motion is working?</strong>"),
  p(
    "We define a small set of leading indicators at the start\u2014pipeline created, conversion at the right stages, sales-cycle length, segment-level efficiency\u2014and put a review cadence in place to interpret them. The point is to make the difference between a soft month and a structurally broken motion visible early, so you can correct course before the lagging indicators catch up.",
  ),
].join("\n");

const ROADMAPS_FAQ_HTML = [
  p("<strong>What\u2019s the difference between a roadmap and a backlog?</strong>"),
  p(
    "A backlog is a list of work; a roadmap is a sequenced narrative about how the business gets from where it is to where it intends to be. Good roadmaps connect strategy to outcomes, group work into themes that fit together, sequence the themes around the dependencies that actually exist, and explain the trade-offs leadership chose. Roadmaps that read as a feature list with dates attached are usually the symptom of skipping that translation step.",
  ),
  p("<strong>How far out should a roadmap actually plan?</strong>"),
  p(
    "Specific commitments belong in the next quarter. The next two quarters should describe themes and intent rather than features. Anything beyond that is direction\u2014useful for alignment, but presented as such, not as a plan. The instinct to publish a detailed multi-year roadmap usually backfires; the further out the dates extend, the less the roadmap is trusted by the people executing it.",
  ),
  p("<strong>Who should own the roadmap inside the company?</strong>"),
  p(
    "A single executive owner accountable for outcomes\u2014typically the head of product or the GM of the relevant business unit. The roadmap is built collaboratively (engineering, design, marketing, sales, finance all contribute), but ownership of the trade-offs and the resulting commitments has to sit in one place. Roadmaps that are owned by a committee are roadmaps that drift.",
  ),
  p("<strong>How do we keep the roadmap honest as conditions change?</strong>"),
  p(
    "By instituting a quarterly review where the roadmap is re-evaluated against what\u2019s been learned, what\u2019s shipped, and what\u2019s changed in the market. Items earn their place by continuing to be the right next investment, not by inertia. The review should also surface assumptions that didn\u2019t hold so the team builds the muscle of revising plans without treating revision as failure.",
  ),
].join("\n");

const COMMS_FAQ_HTML = [
  p("<strong>What kinds of communication problems do you typically work on?</strong>"),
  p(
    "Internal communications that aren\u2019t landing\u2014strategy memos that don\u2019t move behavior, all-hands content that doesn\u2019t carry, leadership voices that lack a consistent narrative\u2014and external moments that require careful framing, such as repositioning, restructuring, or major product news. The common thread is communications that need to do real work rather than fill an airtime slot.",
  ),
  p("<strong>How do you make sure communications change behavior, not just inform?</strong>"),
  p(
    "By starting from the behavior we want and working backward to the message, the messenger, and the cadence. Information delivery alone rarely changes behavior; what changes behavior is the right person, saying the right thing, repeated in the right places, reinforced by what leaders actually do. We design communications as systems, not single events.",
  ),
  p("<strong>Do you write the communications, or coach the leaders who deliver them?</strong>"),
  p(
    "Both, depending on the engagement. We draft communications when speed and craft matter; we coach leaders when the long-term goal is for them to own their voice. Most engagements blend the two\u2014we draft the early artifacts to set the bar, then transition to coaching as the leadership team builds confidence.",
  ),
  p("<strong>How do you handle sensitive announcements\u2014restructuring, leadership change, strategic pivots?</strong>"),
  p(
    "Carefully and in tight collaboration with leadership, HR, and legal. The work centers on sequencing the audiences correctly, choosing language that\u2019s honest without being clumsy, anticipating the questions that will follow, and preparing the leaders who will field them. Done well, sensitive announcements protect trust; done poorly, they erode it for years.",
  ),
].join("\n");

const DELIVERY_FAQ_HTML = [
  p("<strong>When does an engagement actually need delivery management support?</strong>"),
  p(
    "When the work is cross-functional, the timeline is tight, and the cost of a missed handoff is higher than the cost of a coordinator. Delivery management earns its keep on initiatives where multiple teams need to converge on a date, where dependencies aren\u2019t all visible from any one team\u2019s vantage point, and where leadership needs a single source of truth on status without sitting in every standup.",
  ),
  p("<strong>Are you running the project, or supporting our internal project leads?</strong>"),
  p(
    "Either model works. On greenfield initiatives we often run the program end to end, including stakeholder cadence, risk management, and reporting. When an internal lead exists, we operate as a force multiplier\u2014owning the discipline (status, risks, dependencies, decisions) so the internal lead can focus on the substantive work and the people. We agree on the model at kickoff.",
  ),
  p("<strong>How do you avoid the trap of becoming a status-meeting machine?</strong>"),
  p(
    "By treating status as a byproduct of well-run delivery, not the product. The artifacts we maintain (decision log, dependency map, risk register, milestone view) are designed to make status fall out of the work rather than requiring people to assemble it. Standing meetings exist only when a forcing function is needed; when the artifact is enough, the meeting goes away.",
  ),
  p("<strong>What happens when the engagement ends?</strong>"),
  p(
    "The artifacts and operating cadence transfer to your internal owner. Where the engagement establishes a new program management practice, we document the patterns, run a knowledge-transfer session, and stay available for a defined wind-down period to answer questions. The goal is for delivery discipline to outlast our involvement, not to embed a permanent dependency.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// Enrichments registry
// ---------------------------------------------------------------------------

interface Enrichment {
  slug: string;
  label: string;
  acceleratorsHtml: string | null;
  faqHtml: string;
}

const ENRICHMENTS: Enrichment[] = [
  {
    slug: "microsoft-partner-development",
    label: "Microsoft Partner Development",
    acceleratorsHtml: PARTNER_ACCELERATORS_HTML,
    faqHtml: PARTNER_FAQ_HTML,
  },
  {
    slug: "ai-strategy-and-design",
    label: "AI Strategy and Design",
    acceleratorsHtml: AI_ACCELERATORS_HTML,
    faqHtml: AI_FAQ_HTML,
  },
  {
    slug: "employee-effectiveness",
    label: "Employee Effectiveness",
    acceleratorsHtml: EMPLOYEE_ACCELERATORS_HTML,
    faqHtml: EMPLOYEE_FAQ_HTML,
  },
  {
    slug: "company-os",
    label: "Company OS",
    acceleratorsHtml: COMPANY_OS_ACCELERATORS_HTML,
    faqHtml: COMPANY_OS_FAQ_HTML,
  },
  {
    slug: "employee-strategies",
    label: "Employee Strategies",
    acceleratorsHtml: EMPLOYEE_STRATEGIES_ACCELERATORS_HTML,
    faqHtml: EMPLOYEE_STRATEGIES_FAQ_HTML,
  },
  // FAQ-only enrichments (no Zenith callout). acceleratorsHtml is left
  // untouched so the page renders the FAQ section without an irrelevant
  // tool spotlight.
  {
    slug: "brand-and-messaging",
    label: "Brand and Messaging",
    acceleratorsHtml: null,
    faqHtml: BRAND_FAQ_HTML,
  },
  {
    slug: "design-strategies",
    label: "Design Strategies",
    acceleratorsHtml: null,
    faqHtml: DESIGN_FAQ_HTML,
  },
  {
    slug: "fractional-leadership",
    label: "Fractional Leadership",
    acceleratorsHtml: null,
    faqHtml: FRACTIONAL_FAQ_HTML,
  },
  {
    slug: "gtm-strategy-and-execution",
    label: "GTM Strategy and Execution",
    acceleratorsHtml: null,
    faqHtml: GTM_FAQ_HTML,
  },
  {
    slug: "strategic-roadmaps",
    label: "Strategic Roadmaps",
    acceleratorsHtml: null,
    faqHtml: ROADMAPS_FAQ_HTML,
  },
  {
    slug: "communication-strategies",
    label: "Communication Strategies",
    acceleratorsHtml: null,
    faqHtml: COMMS_FAQ_HTML,
  },
  {
    slug: "delivery-management",
    label: "Delivery Management",
    acceleratorsHtml: null,
    faqHtml: DELIVERY_FAQ_HTML,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let updated = 0;
  let notFound = 0;

  for (const enrichment of ENRICHMENTS) {
    // NB: select id only rather than `db.query.solutionsTable.findFirst()` —
    // the latter expands to `SELECT *` and pulls the `search_tsv` generated
    // column added by #170 (Public-site search via Postgres FTS). That
    // column lives in the schema but is created by api-server's startup
    // migrations, not drizzle-kit push (drizzle-kit can't model
    // `GENERATED ALWAYS AS … STORED`). post-merge.sh runs `db push` then
    // this seed before the api-server has had a chance to boot, so on a
    // freshly-pulled prod DB the column is missing and the SELECT fails
    // with `errorMissingColumn`. Selecting only `id` sidesteps the
    // generated column entirely and keeps the seed independent of FTS
    // setup ordering.
    const [solution] = await db
      .select({ id: solutionsTable.id })
      .from(solutionsTable)
      .where(eq(solutionsTable.slug, enrichment.slug))
      .limit(1);

    if (!solution) {
      console.warn(
        `  [WARN] Solution not found: "${enrichment.label}" (slug: ${enrichment.slug}). Skipping.`,
      );
      notFound++;
      continue;
    }

    // For FAQ-only enrichments (acceleratorsHtml === null) we deliberately
    // skip the accelerators column so we don't blow away anything a future
    // solution-specific seed has placed there. The faqHtml column is the
    // only field we always own.
    const updateSet: {
      faqHtml: string;
      updatedAt: Date;
      acceleratorsHtml?: string;
    } = {
      faqHtml: enrichment.faqHtml,
      updatedAt: new Date(),
    };
    if (enrichment.acceleratorsHtml !== null) {
      updateSet.acceleratorsHtml = enrichment.acceleratorsHtml;
    }

    await db
      .update(solutionsTable)
      .set(updateSet)
      .where(eq(solutionsTable.id, solution.id));

    console.log(`  [OK] Updated "${enrichment.label}" (${solution.id})`);
    updated++;
  }

  console.log(
    `\nDone. ${updated} solution(s) updated, ${notFound} not found.`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
