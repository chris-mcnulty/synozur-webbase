/**
 * Idempotent seed — enriches the following solutions with Zenith/accelerators
 * callout content and solution-specific FAQs:
 *
 *   - Microsoft Partner Development  (slug: microsoft-partner-development)
 *   - AI Strategy and Design         (slug: ai-strategy-and-design)
 *   - Employee Effectiveness         (slug: employee-effectiveness)
 *   - Company OS                     (slug: company-os)
 *   - Employee Strategies            (slug: employee-strategies)
 *
 * Communication Strategies and Delivery Management are intentionally not
 * enriched: their connection to Zenith is too indirect to justify a callout.
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

function ul(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

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
    "<strong><a href=\"https://zenith.synozur.com\">Zenith</a></strong> is Synozur\u2019s Microsoft 365 Governance Command Center, and it complements Company OS engagements that rely on Microsoft 365\u2014particularly when Vega is the operating backbone.",
  ),
  p(
    "A Company OS only works if the systems supporting it are trustworthy. When SharePoint, Teams, and OneDrive house the policies, processes, and decisions that run the business, governance posture directly affects how reliably the operating system performs. Zenith surfaces workspace health, ownership, sharing, and policy alignment across the tenant so the structures Company OS depends on stay clean as the organization grows.",
  ),
  p(
    "For clients standardizing on Vega, Zenith provides the continuous governance signal needed to keep the operating environment well-organized, well-labeled, and ready for AI-assisted work.",
  ),
].join("\n");

const COMPANY_OS_FAQ_HTML = [
  p("<strong>How does Zenith fit into a Company OS engagement?</strong>"),
  p(
    "Company OS defines how the business runs\u2014decisions, rituals, ownership, and the systems that carry them. When those systems live in Microsoft 365, Zenith makes sure the underlying workspaces are well-governed, findable, and aligned to the policies your operating model assumes are in place. It\u2019s not required to start a Company OS engagement, but it removes a common source of friction when Microsoft 365 is the primary operating environment.",
  ),
  p("<strong>Do we need Zenith if we\u2019re using Vega?</strong>"),
  p(
    "Vega and Zenith solve different problems. Vega is the operating system for how work gets done; Zenith monitors the governance health of the Microsoft 365 environment that Vega often runs on. Many clients use both: Vega to define and run the operating model, Zenith to keep the M365 foundation healthy underneath it.",
  ),
  p("<strong>What signals does Zenith provide that matter for a Company OS?</strong>"),
  p(
    "Zenith highlights workspaces with unclear ownership, inconsistent governance, weak sensitivity labeling, or risky sharing\u2014the same conditions that create confusion about \u201cwhere does this live\u201d and \u201cwho owns this.\u201d Resolving them makes the operating model easier to follow and reduces the day-to-day friction employees feel when navigating the environment.",
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
// Enrichments registry
// ---------------------------------------------------------------------------

interface Enrichment {
  slug: string;
  label: string;
  acceleratorsHtml: string;
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
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let updated = 0;
  let notFound = 0;

  for (const enrichment of ENRICHMENTS) {
    const solution = await db.query.solutionsTable.findFirst({
      where: eq(solutionsTable.slug, enrichment.slug),
    });

    if (!solution) {
      console.warn(
        `  [WARN] Solution not found: "${enrichment.label}" (slug: ${enrichment.slug}). Skipping.`,
      );
      notFound++;
      continue;
    }

    await db
      .update(solutionsTable)
      .set({
        acceleratorsHtml: enrichment.acceleratorsHtml,
        faqHtml: enrichment.faqHtml,
        updatedAt: new Date(),
      })
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
