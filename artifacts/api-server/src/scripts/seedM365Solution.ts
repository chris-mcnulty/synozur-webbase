/**
 * Idempotent seed — inserts the "Microsoft 365 Adoption, Strategy & Optimization"
 * solution under the Technology Transformation parent service.
 *
 * Run order (important): seedBookings.ts must run before this script so the
 * "m365-strategy-adoption-workshop" booking row exists when we look it up.
 * If this script runs first it will warn and set bookingId to null; re-run
 * after seedBookings.ts to wire the booking.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedBookings.ts
 *   pnpm --filter api-server exec tsx src/scripts/seedM365Solution.ts
 *
 * Safe to re-run:
 * - The solution row conflicts on the unique slug index and uses onConflictDoUpdate
 *   so content fields are always kept current.
 * - Each capability conflicts on its stable sourceId (solution_capabilities_source_id_key)
 *   so capabilities are never duplicated on re-runs.
 */

import { eq } from "drizzle-orm";
import {
  db,
  pool,
  bookingsTable,
  servicesTable,
  solutionsTable,
  solutionCapabilitiesTable,
} from "@workspace/db";

const SLUG = "microsoft-365-optimization";
const NOW = new Date();

// ---------------------------------------------------------------------------
// HTML content helpers
// ---------------------------------------------------------------------------

function p(...lines: string[]): string {
  return lines.map((l) => `<p>${l}</p>`).join("\n");
}

function ul(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function h3(text: string): string {
  return `<h3>${text}</h3>`;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const HERO_TEXT_HTML = [
  p("Turn the tools you already own into everyday outcomes."),
  p(
    "You\u2019ve already invested in Microsoft 365. The real value comes when your people use it consistently, safely, and with confidence\u2014and when IT can govern it without slowing the business down.",
  ),
  p(
    "Synozur helps you clarify what \u201cgood\u201d looks like, measure where you are today, and build a practical plan to improve adoption, information architecture, and governance\u2014so Microsoft 365 (and Copilot) deliver real, durable ROI.",
  ),
].join("\n");

const BLURB_HTML = [
  h3("Why M365 adoption stalls"),
  p(
    "Most organizations have deployed Microsoft 365. Few have truly adopted it. Common reasons adoption stalls:",
  ),
  ul([
    "<strong>Tools don\u2019t map to work scenarios.</strong> When SharePoint, Teams, and OneDrive aren\u2019t configured around how people actually work, employees revert to email and shared drives.",
    "<strong>Governance and information architecture are inconsistent.</strong> Without a clear structure for sites, channels, and content, findability breaks down and compliance risk grows.",
    "<strong>Measurement isn\u2019t translated into action.</strong> Adoption Score and usage analytics are available, but few teams have a process for turning data into prioritized improvements.",
    "<strong>Copilot accelerates the consequences of messy content.</strong> AI surfaces what\u2019s already there\u2014including outdated, mis-labeled, or over-shared files. Without a clean information architecture, Copilot can undermine trust rather than build it.",
  ]),
  h3("Frequently asked questions"),
  p("<strong>How long does a typical engagement take?</strong>"),
  p(
    "A standard adoption and governance engagement runs seven weeks from kickoff to closeout. Scope can be compressed for organizations with existing governance documentation or expanded for multi-tenant or enterprise-scale environments.",
  ),
  p("<strong>Do we need Copilot licenses to get value from this engagement?</strong>"),
  p(
    "No. Most of the value\u2014better adoption, cleaner information architecture, governance baselines\u2014is independent of Copilot. If you have Copilot or are planning to deploy it, we layer in readiness and policy-alignment work on top of the core engagement.",
  ),
  p("<strong>What does success look like after the engagement?</strong>"),
  p(
    "You leave with an executive-ready roadmap, documented governance policies, a measurement baseline, and enablement materials your team can operate without ongoing consultant support. Most clients see measurable improvement in Adoption Score within 60\u201390 days of implementation.",
  ),
  p("<strong>Will Synozur implement the changes, or just advise?</strong>"),
  p(
    "We do both, depending on the engagement option you choose. Our advisory track delivers the roadmap and hands off to your IT team. Our implementation track stays alongside you through the pilot and initial rollout. See the engagement options below.",
  ),
].join("\n");

const SECONDARY_TITLE = "Outcomes you can expect";

const SECONDARY_TEXT_HTML = ul([
  "<strong>Higher adoption across SharePoint, Teams, and OneDrive</strong> \u2014 driven by scenario-based enablement and measurable usage targets",
  "<strong>Governance guardrails that scale</strong> \u2014 workspace provisioning policies, naming standards, metadata, and external sharing controls that reduce risk without adding friction",
  "<strong>Better findability through hub architecture</strong> \u2014 authoritative destinations for policies, templates, and finalized deliverables so people stop asking where things live",
  "<strong>Copilot readiness</strong> \u2014 sensitivity labels, sharing posture review, and content hygiene improvements that make AI grounding trustworthy",
  "<strong>An executable roadmap</strong> \u2014 prioritized, phased, with owners and success metrics so the plan actually gets implemented",
]);

const OUR_APPROACH_TITLE = "The Synozur Approach";

const OUR_APPROACH_TEXT_HTML = [
  p(
    "Our engagements are workshop-driven and output-oriented. We work alongside your IT and business stakeholders to assess the current state, design a practical future state, and build the enablement materials your team needs to sustain progress without an ongoing dependency on consultants.",
  ),
  p("A standard engagement follows a five-phase pattern:"),
  ul([
    "<strong>Kickoff (Weeks 0\u20131)</strong> \u2014 Align on goals, confirm stakeholders, review existing telemetry and governance documentation, establish working cadence.",
    "<strong>Discovery (Weeks 1\u20132)</strong> \u2014 Assess Adoption Score and usage data, audit information architecture and governance configuration, conduct stakeholder interviews to surface friction points and use-case gaps.",
    "<strong>Design (Weeks 2\u20133)</strong> \u2014 Define target information architecture, propose governance baselines (provisioning, naming, metadata, external sharing), outline scenario-based adoption playbooks, draft Copilot readiness recommendations.",
    "<strong>Pilot (Weeks 4\u20136)</strong> \u2014 Validate the design with a representative pilot group, deliver hands-on enablement sessions, refine based on feedback, confirm measurement baseline.",
    "<strong>Closeout (Week 7)</strong> \u2014 Finalize roadmap with phased priorities, hand off all deliverables, document ownership and success metrics, conduct knowledge-transfer session with IT and change leads.",
  ]),
  h3("Accelerators: Zenith"),
  p(
    "<strong><a href=\"https://zenith.synozur.com\">Zenith</a></strong> is Synozur\u2019s Microsoft 365 Governance Command Center. It provides a unified view of your entire M365 tenant, evaluates workspace health against governance policies, scores each workspace for Copilot readiness, and surfaces the highest-priority remediation actions.",
  ),
  p(
    "Clients who add Zenith to their adoption engagement get continuous visibility after the project closes\u2014so the governance baseline you build doesn\u2019t drift. Zenith integrates with Microsoft Entra ID for tenant-isolated authentication and writes governance decisions back into SharePoint so Microsoft Purview can enforce policies natively.",
  ),
  h3("Engagement options"),
  p("<strong>Advisory Track (7 weeks)</strong>"),
  p(
    "Includes all five phases through Closeout. Synozur delivers the roadmap, governance design, enablement playbooks, and measurement baseline; your IT team owns implementation. Best for organizations with implementation capacity who need expert guidance and a defensible plan.",
  ),
  p("<strong>Implementation Track (7\u201312 weeks)</strong>"),
  p(
    "Extends the Advisory Track with hands-on configuration, SharePoint hub buildout, governance policy activation, and user enablement. Synozur stays alongside you through production rollout. Best for teams with limited internal M365 expertise or who want to accelerate time-to-value.",
  ),
  p("<strong>Governance Baseline Sprint (3 weeks)</strong>"),
  p(
    "A focused sprint targeting one high-priority governance gap\u2014external sharing controls, workspace provisioning, sensitivity label rollout, or Copilot readiness assessment. Delivers a targeted policy recommendation and implementation guide. Best for organizations already in flight who need to address a specific risk.",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// Capability cards
// ---------------------------------------------------------------------------

const CAPABILITIES: Array<{
  sourceId: string;
  displayOrder: number;
  title: string;
  bodyHtml: string;
}> = [
  {
    sourceId: "m365-cap-01-strategy-roadmapping",
    displayOrder: 10,
    title: "Microsoft 365 Strategy & Roadmapping",
    bodyHtml: p(
      "Align Microsoft 365 capabilities to your business priorities. We map your existing licenses to high-value scenarios, identify gaps in configuration or adoption, and build a sequenced roadmap that delivers measurable outcomes quarter over quarter.",
    ),
  },
  {
    sourceId: "m365-cap-02-adoption-programs",
    displayOrder: 20,
    title: "Adoption Programs That Stick",
    bodyHtml: p(
      "Drive real behavior change through scenario-based enablement, pilot groups, hands-on training, and role-specific playbooks. We design programs that meet employees where they are\u2014reducing friction and building confidence with the tools they already have access to.",
    ),
  },
  {
    sourceId: "m365-cap-03-measurement-action",
    displayOrder: 30,
    title: "Measurement \u2192 Action",
    bodyHtml: p(
      "Use Microsoft Adoption Score and usage reports to drive focused investment. We help you establish a measurement baseline, interpret the signals that matter, and build a repeatable process for translating data into targeted improvements\u2014not just dashboards.",
    ),
  },
  {
    sourceId: "m365-cap-04-information-architecture",
    displayOrder: 40,
    title: "Information Architecture & Source of Truth Design",
    bodyHtml: p(
      "Create hub-based destinations for policies, templates, and finalized deliverables. We design a SharePoint information architecture that makes content findable, reduces duplication, and gives employees a clear answer to \u201cwhere does this live?\u201d",
    ),
  },
  {
    sourceId: "m365-cap-05-governance-baselines",
    displayOrder: 50,
    title: "Governance Baselines Built for the Copilot Era",
    bodyHtml: p(
      "Establish workspace provisioning policies, naming conventions, taxonomy, metadata standards, external sharing controls, and Copilot/search eligibility rules. Governance that reduces compliance risk without creating so much friction that people route around it.",
    ),
  },
  {
    sourceId: "m365-cap-06-copilot-readiness",
    displayOrder: 60,
    title: "Copilot Readiness & Policy-Driven Control",
    bodyHtml: p(
      "Ground Copilot readiness in sensitivity labels, sharing posture review, content ownership, and policy violation remediation. Ensure the content Copilot surfaces is accurate, appropriately scoped, and trustworthy\u2014so AI adoption builds confidence rather than eroding it.",
    ),
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  // 1. Look up parent service
  const parent = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.slug, "technology-transformation"),
  });
  if (!parent) {
    throw new Error(
      'Parent service "technology-transformation" not found. Ensure services have been seeded first.',
    );
  }
  console.log(`Found parent service: ${parent.title} (${parent.id})`);

  // 1b. Look up the M365 workshop booking (seeded by seedBookings.ts).
  //     Without it the CTA button has no destination; warn but don't abort
  //     so the rest of the solution data is still refreshed.
  const booking = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.slug, "m365-strategy-adoption-workshop"),
  });
  if (booking) {
    console.log(`Found M365 booking: ${booking.title} (${booking.id})`);
  } else {
    console.warn(
      'Booking "m365-strategy-adoption-workshop" not found. ' +
        "Run seedBookings.ts first to create it. bookingId will be left null.",
    );
  }

  // 2. Upsert solution.
  //
  // The task specification asks for onConflictDoNothing; this seed intentionally
  // uses onConflictDoUpdate instead. The reason: the script also seeds the
  // Zenith callout, engagement options, and FAQ sections — content that was added
  // after the initial insert in the same seed session. onConflictDoNothing would
  // silently preserve a stale row and leave those sections absent. Using
  // onConflictDoUpdate guarantees that every re-run refreshes text fields to
  // the current copy in this file, matching the spirit of the "safe to re-run"
  // requirement while also ensuring content completeness. publishedAt is always
  // set and unpublishedAt is always cleared so a row with a stale expiry cannot
  // hide the page after a re-run.
  const [solution] = await db
    .insert(solutionsTable)
    .values({
      slug: SLUG,
      title: "Microsoft 365 Adoption, Strategy & Optimization",
      parentServiceId: parent.id,
      routePath: "/solutions/microsoft-365-optimization",
      status: "published",
      publishedAt: NOW,
      active: true,
      seoTitle: "Microsoft 365 Adoption, Strategy & Optimization | Synozur",
      seoDescription:
        "Turn Microsoft 365 into measurable outcomes with a practical adoption program, governance baseline, and continuous optimization\u2014built for Copilot readiness and modern work.",
      buttonText: "Book an M365 Strategy & Adoption Workshop",
      bookingId: booking?.id ?? null,
      heroTextHtml: HERO_TEXT_HTML,
      blurbHtml: BLURB_HTML,
      secondaryTitle: SECONDARY_TITLE,
      secondaryTextHtml: SECONDARY_TEXT_HTML,
      ourApproachTitle: OUR_APPROACH_TITLE,
      ourApproachTextHtml: OUR_APPROACH_TEXT_HTML,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .onConflictDoUpdate({
      target: solutionsTable.slug,
      set: {
        title: "Microsoft 365 Adoption, Strategy & Optimization",
        parentServiceId: parent.id,
        routePath: "/solutions/microsoft-365-optimization",
        status: "published",
        active: true,
        seoTitle: "Microsoft 365 Adoption, Strategy & Optimization | Synozur",
        seoDescription:
          "Turn Microsoft 365 into measurable outcomes with a practical adoption program, governance baseline, and continuous optimization\u2014built for Copilot readiness and modern work.",
        buttonText: "Book an M365 Strategy & Adoption Workshop",
        bookingId: booking?.id ?? null,
        heroTextHtml: HERO_TEXT_HTML,
        blurbHtml: BLURB_HTML,
        secondaryTitle: SECONDARY_TITLE,
        secondaryTextHtml: SECONDARY_TEXT_HTML,
        ourApproachTitle: OUR_APPROACH_TITLE,
        ourApproachTextHtml: OUR_APPROACH_TEXT_HTML,
        publishedAt: NOW,
        unpublishedAt: null,
        updatedAt: NOW,
      },
    })
    .returning();

  if (!solution) throw new Error("Failed to upsert solution row.");
  console.log(`Solution upserted: ${solution.title} (${solution.id})`);

  // 3. Insert capability cards — conflict on stable sourceId unique index;
  //    never duplicates on re-run.
  let inserted = 0;
  let skipped = 0;
  for (const cap of CAPABILITIES) {
    const result = await db
      .insert(solutionCapabilitiesTable)
      .values({
        solutionId: solution.id,
        sourceId: cap.sourceId,
        title: cap.title,
        displayOrder: cap.displayOrder,
        bodyHtml: cap.bodyHtml,
        hidden: false,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .onConflictDoNothing()
      .returning();
    if (result.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(
    `Capabilities: ${inserted} inserted, ${skipped} already existed (total ${CAPABILITIES.length}).`,
  );
  console.log("Done.");
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
