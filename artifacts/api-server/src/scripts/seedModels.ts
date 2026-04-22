/**
 * Seed the `models` table from the Wix CMS export (Models_1776860176903.csv).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedModels.ts
 *
 * Idempotent: deduplicates by slug; re-running updates existing rows in place.
 * After seeding, each model is also synced to the collateral library so it
 * appears in the resource carousel without a separate step.
 */
import { eq } from "drizzle-orm";
import { db, modelsTable, pool } from "@workspace/db";
import { upsertCollateralFromModel } from "../lib/syncCollateral";

function wixImg(mediaId: string): string {
  return `https://static.wixstatic.com/media/${mediaId}`;
}

interface ModelSeed {
  slug: string;
  title: string;
  shortDescription: string;
  longDescriptionHtml: string;
  dimensionsHtml: string;
  heroImage: string;
  launchUrl: string;
  pillar: "strategic" | "technology" | "experiences" | "gtm" | null;
  publishedAt: Date;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

const MODELS: ModelSeed[] = [
  {
    slug: "ai-maturity-model",
    title: "AI Maturity Model",
    shortDescription:
      "Evaluate your organization's AI readiness and maturity across key dimensions including strategy, infrastructure, talent, and implementation capabilities.",
    longDescriptionHtml: `<p>The <strong>Synozur AI Maturity Model</strong> is a five‑stage framework—<strong>Explore</strong>, <strong>Build</strong>, <strong>Scale</strong>, <strong>Transform</strong>, <strong>Frontier</strong>—that gives business and technology leaders a common language to assess readiness, align investments, and sequence AI initiatives with confidence. It's designed to move you from isolated experimentation to an enterprise growth engine where AI is orchestrated across people, process, data, and platforms.</p>
<p><strong>How it works</strong><br>A conversational, guided assessment produces an <strong>AI maturity score on a 100–500 scale</strong>, then maps targeted "next‑level" actions by dimension. The experience was specified for executives and IT leaders—clear, empathetic, and outcome‑focused—so teams can act immediately, not just admire the problem.</p>
<p><strong>What you receive</strong></p>
<ul>
  <li><strong>Instant results—no login required:</strong> complete the assessment and immediately see your <strong>100–500 maturity score</strong>.</li>
  <li><strong>Downloadable PDF report:</strong> personalized recommendations by stage and dimension, plus a shareable summary for stakeholders.</li>
  <li><strong>Follow‑on resources:</strong> links to best‑practice guides, workshops, and enablement to move from score to impact.</li>
</ul>`,
    dimensionsHtml: `<h3>Maturity Scale Levels</h3>
<p><strong>Explore (100-199)</strong><br>Organizations experiment with isolated AI pilots led by enthusiasts, but lack strategic direction, governance, and coordinated leadership, resulting in limited business impact and "pilot paralysis."</p>
<p><strong>Build (200-299)</strong><br>Companies begin laying strategic and technical foundations for AI, investing in data infrastructure and governance, with formal leadership emerging but business value still constrained by talent gaps and low adoption.</p>
<p><strong>Scale (300-399)</strong><br>AI is deployed across multiple business functions with measurable impact, supported by cross-functional governance and strong business-technology alignment, though scaling is challenged by workforce retraining and cultural resistance.</p>
<p><strong>Transform (400-449)</strong><br>AI becomes a strategic driver embedded in core operations and decision-making, championed by C-suite leaders, delivering competitive advantages through innovation, personalization, and operational efficiency.</p>
<p><strong>Frontier (450-500)</strong><br>The organization reinvents its business model with an AI-first culture, treating AI as an omnipresent utility, enabling dynamic human–AI teams and autonomous systems that continuously optimize operations and set new industry standards.</p>
<h3>Dimensions</h3>
<p><strong>Strategy &amp; Leadership</strong><br>The organization's vision, executive sponsorship, and strategic alignment ensure AI initiatives are prioritized, funded, and integrated with high-value business goals.</p>
<p><strong>Talent &amp; Skills</strong><br>The workforce is equipped with the necessary AI expertise, upskilling programs, and cross-functional collaboration to drive adoption and innovation.</p>
<p><strong>Data &amp; Infrastructure</strong><br>Robust data pipelines, cloud platforms, and secure infrastructure provide the technical foundation for scalable, reliable, and high-impact AI solutions.</p>
<p><strong>Use Case Integration</strong><br>AI is embedded into core business processes and products, with measurable outcomes tied to enterprise KPIs and operational workflows.</p>
<p><strong>Governance &amp; Responsible AI</strong><br>Ethical, secure, and transparent AI practices are institutionalized through strong governance frameworks, risk management, and compliance with emerging regulations.</p>
<p><strong>Culture &amp; Change Management</strong><br>An AI-ready culture fosters agility, experimentation, and continuous learning, supported by effective change management and broad workforce engagement.</p>`,
    heroImage: wixImg("b805ce_9027f93fb21340c1b3f7a9e25b1f832b~mv2.jpeg"),
    launchUrl: "https://aimaturity.synozur.com",
    pillar: "strategic",
    publishedAt: new Date("2025-10-14T17:19:57Z"),
    featured: true,
    featuredRank: 1,
    seoTitle: "AI Maturity Model — Assess Your Organization's AI Readiness",
    seoDescription:
      "Benchmark your AI maturity across five stages: Explore, Build, Scale, Transform, Frontier. Free assessment with instant 100–500 score and downloadable PDF report.",
  },
  {
    slug: "gtm-maturity-model",
    title: "GTM Maturity Model",
    shortDescription:
      "The Go-To-Market (GTM) Maturity model measures how ready your organization is to scale by evaluating its approach to launching and selling products—covering market fit, brand clarity, pricing strategy, demand generation, sales enablement, and collateral effectiveness.",
    longDescriptionHtml: `<p>The GTM Maturity model evaluates how effectively your organization approaches go-to-market and business development across six critical dimensions: <strong>Market Fit</strong>, ensuring clear problem–solution alignment and segmentation; <strong>Brand, Naming &amp; Messaging</strong>, creating a differentiated narrative and portfolio clarity; <strong>Pricing, Packaging &amp; Monetization</strong>, driving value-based pricing and disciplined discounting; <strong>Demand Engine</strong>, integrating inbound, outbound, digital, and event strategies for pipeline growth; <strong>Sales &amp; Channels</strong>, equipping teams and partners with plays and assets to accelerate wins; and <strong>Collateral</strong>, leveraging high-impact content and artifacts to amplify product value.</p>
<p>Together, these dimensions provide a structured framework for assessing readiness, identifying gaps, and unlocking AI-powered recommendations for scalable growth.</p>
<p><strong>What you receive</strong></p>
<ul>
  <li><strong>Instant results—no login required:</strong> complete the assessment and immediately see your <strong>100–500 maturity score</strong>.</li>
  <li><strong>Downloadable PDF report:</strong> personalized recommendations by stage and dimension, plus a shareable summary for stakeholders.</li>
  <li><strong>Follow‑on resources:</strong> links to best‑practice guides, workshops, and enablement to move from score to impact.</li>
</ul>`,
    dimensionsHtml: `<h3>Dimensions</h3>
<p><strong>Market Fit</strong><br>Validates problem–solution fit, segmentation, and persona clarity to focus pipeline on winnable customers.</p>
<p><strong>Brand, Naming &amp; Messaging</strong><br>Ensures a clear, differentiated narrative (MPF), portfolio naming, and proofs that land value with buyers.</p>
<p><strong>Pricing, Packaging &amp; Monetization</strong><br>Aligns value‑based pricing, tiers/add‑ons, and discount discipline to drive healthy ASP and expansion.</p>
<p><strong>Demand Engine</strong><br>(Inbound, Outbound, Digital &amp; Events) — Orchestrates content/SEO, paid, SDR outbound, social/influencer, and event programs into qualified pipeline.</p>
<p><strong>Sales &amp; Channels</strong><br>Equips field/partners with plays, battlecards, and assets to improve win rates and cycle times.</p>
<p><strong>Collateral</strong><br>Documents, papers, videos, images, pitch decks, demonstrations - the digital artifacts used to repeat and amplify product value.</p>
<h3>Maturity Scale Levels</h3>
<p><strong>Initial (100-199)</strong><br>Beginning GTM journey</p>
<p><strong>Emerging (200-299)</strong><br>Experimenting with GTM</p>
<p><strong>Defined (300-399)</strong><br>Operational GTM processes</p>
<p><strong>Measured (400-449)</strong><br>Strategic GTM foundations</p>
<p><strong>Optimizing (450-500)</strong><br>Leading GTM transformation</p>`,
    heroImage: wixImg("b805ce_610645951fa747adaad22b93eb3c8dd9~mv2.png"),
    launchUrl: "https://orion.synozur.com/gtm",
    pillar: "gtm",
    publishedAt: new Date("2025-12-18T18:12:35Z"),
    featured: true,
    featuredRank: 2,
    seoTitle: "GTM Maturity Model — Assess Your Go-To-Market Readiness",
    seoDescription:
      "Evaluate your GTM maturity across market fit, brand, pricing, demand generation, sales, and collateral. Free assessment with instant score and PDF report.",
  },
  {
    slug: "management-and-company-os",
    title: "Management and Company OS",
    shortDescription:
      "Evaluate how effectively your organization runs — from mission and goals to strategy, management rhythm, and execution. A fast, structured assessment that shows you where your Company Operating System stands and where to go next.",
    longDescriptionHtml: `<p>Most organizations have a strategy — but far fewer have a system to run it. The Company OS Maturity Model helps leadership teams assess the health of their management and operating frameworks across five critical dimensions: Business Foundations, Goals, Strategy, Management Framework, and Founder/Leadership Dependence. Scored on a 100–500 scale aligned to CMMI principles, the model pinpoints where your organization operates reactively, where it runs with discipline, and where it's truly integrated and data-driven. In 10–15 minutes, you'll get a clear picture of your current state — and a roadmap to close the gaps between where you are and where you need to be.</p>`,
    dimensionsHtml: `<ul>
  <li><strong>100 – Initial:</strong> Business foundations are undocumented, goals are undefined, strategy is absent or siloed, and management decisions run through the founder with no distributed authority.</li>
  <li><strong>200 – Managed:</strong> A mission statement exists but isn't widely known, high-level goals are defined, divisional plans are mistaken for strategy, and some regular meetings and communications are in place.</li>
  <li><strong>300 – Defined:</strong> Mission, vision, and values are documented and accessible, goals are established and shared annually, strategy choices are made intentionally, and a consistent annual planning approach is in place.</li>
  <li><strong>400 – Quantified:</strong> Organizational components are deeply embedded in communications, goals have clear owners and are routinely reviewed, strategy effectiveness is measured with metrics, and leadership operates through a clear hierarchy of SMART goals.</li>
  <li><strong>500 – Integrated:</strong> Alignment with all components is measured and reviewed on a regular schedule, data automatically drives goal evaluation, strategy effectiveness is continuously optimized, and a fully integrated management framework operates at every level of the organization.</li>
</ul>`,
    heroImage: wixImg("b805ce_ce184f8f253d449998f9017fec96d76c~mv2.png"),
    launchUrl: "https://orion.synozur.com/cos-light",
    pillar: "strategic",
    publishedAt: new Date("2026-02-15T22:11:21Z"),
    featured: true,
    featuredRank: 3,
    seoTitle: "Company OS Maturity Model — Assess Your Management System",
    seoDescription:
      "Evaluate your Company Operating System across business foundations, goals, strategy, and management rhythm. Free 10-minute assessment with instant score and roadmap.",
  },
  {
    slug: "content-management-maturity-model",
    title: "Content Management Maturity Model",
    shortDescription:
      "Evaluate your organization's content and document management maturity across leadership, people, technology, processes, GRC, and AI capabilities. Platform-agnostic framework with Microsoft 365 examples.",
    longDescriptionHtml: `<p>The Content Management Maturity Assessment is a structured, research-backed framework aligned to CMMI5 principles that helps organizations evaluate how effectively they manage content and documents across the enterprise.</p>
<p>This model lives inside <strong>Orion</strong> (orion.synozur.com), Synozur's AI-powered transformation assessment platform, which delivers personalized AI-driven insights, industry benchmarking, radar charts, and a downloadable executive report. It's designed to help organizations not just understand <em>where they are</em>, but receive a prioritized roadmap for <em>where to go next</em> — connecting content maturity directly to business outcomes like risk reduction, AI readiness, and operational efficiency. For clients already invested in Microsoft 365, it bridges the gap between technology capability and governance maturity in a single, actionable assessment.</p>`,
    dimensionsHtml: `<p>It assesses maturity across <strong>six dimensions</strong> — Leadership &amp; Governance, People &amp; Skills, Technology &amp; Data, Process &amp; Adoption, GRC (Governance, Risk &amp; Compliance), and AI &amp; Intelligent Document Processing — scoring organizations across five levels from <em>Initial/Ad Hoc</em> through <em>Frontier/Intelligent</em>. The assessment takes 12–15 minutes and generates a maturity score that places the organization on a clear transformation spectrum.</p>
<p>Each of the six dimensions is evaluated independently, though progress in one often enables gains in others. At the lower end, organizations operate reactively — fragmented storage, no governance, manual processes. At the higher end, they run as intelligent enterprises where AI agents autonomously manage information lifecycles, predictive compliance identifies risks before they surface, and content is treated as a strategic business asset driving decision-making. The model is <strong>platform-agnostic by design</strong>, but includes practical Microsoft 365 examples throughout — referencing SharePoint, OneDrive, Microsoft Purview, Azure AI Document Intelligence, and Microsoft Syntex — making it immediately applicable for organizations in the Microsoft ecosystem.</p>`,
    heroImage: wixImg("b805ce_9a2084eef48c4f90ba8406b5c809eff7~mv2.jpeg"),
    launchUrl: "https://orion.synozur.com/content-management-maturity",
    pillar: "technology",
    publishedAt: new Date("2026-02-15T22:13:07Z"),
    featured: true,
    featuredRank: 4,
    seoTitle: "Content Management Maturity Model — Assess Your Content Operations",
    seoDescription:
      "Evaluate your content and document management maturity across governance, people, technology, process, GRC, and AI. CMMI5-aligned framework with Microsoft 365 examples.",
  },
  {
    slug: "knowledge-management-maturity-model",
    title: "Knowledge Management Maturity Model",
    shortDescription:
      "Assess your organization's knowledge management maturity across leadership, culture, processes, technology, risk/compliance, and use of AI. Aligned with APQC, CMMI, and ISO 30401 best practices.",
    longDescriptionHtml: `<p>The Synozur Knowledge Management Maturity Model is a strategic framework designed to help organizations assess, evolve, and optimize how they manage knowledge. Built on industry best practices and aligned with CMMI and APQC principles, the model provides a clear roadmap for transforming knowledge from a fragmented, ad hoc resource into a trusted, enterprise-wide asset. It enables organizations to benchmark their current state, identify capability gaps, and prioritize improvements that drive productivity, innovation, and AI readiness.</p>
<p>The model is structured across five progressive maturity levels—each scored on a 100–500 scale—and evaluated through four critical dimensions: People, Process, Technology, and Governance. As organizations move up the maturity curve, they shift from reactive, siloed knowledge practices to intelligent, adaptive systems that continuously learn and improve.</p>
<p><strong>What you receive</strong></p>
<ul>
  <li><strong>Instant results—no login required:</strong> complete the assessment and immediately see your <strong>100–500 maturity score</strong>.</li>
  <li><strong>Downloadable PDF report:</strong> personalized recommendations by stage and dimension, plus a shareable summary for stakeholders.</li>
  <li><strong>Follow‑on resources:</strong> links to best‑practice guides, workshops, and enablement to move from score to impact.</li>
</ul>`,
    dimensionsHtml: `<h4>Maturity Stages</h4>
<ul>
  <li>🟤 <strong>Level 1: Fragmented &amp; Tribal (Score 100)</strong><br>Knowledge is informal, siloed, and dependent on individuals. No formal KM strategy or tools.</li>
  <li>🟠 <strong>Level 2: Documented but Disconnected (Score 200)</strong><br>Some knowledge is captured, but it's scattered, inconsistent, and lacks governance or trust.</li>
  <li>🟡 <strong>Level 3: Structured &amp; Governed (Score 300)</strong><br>KM is formalized with defined roles, standards, and a central repository. Adoption is growing.</li>
  <li>🟢 <strong>Level 4: Operationalized &amp; Embedded (Score 400)</strong><br>KM is embedded in workflows, widely adopted, and continuously measured for improvement.</li>
  <li>🔵 <strong>Level 5: Intelligent &amp; Adaptive (Score 500)</strong><br>KM is AI-enhanced, self-improving, and a strategic differentiator across the enterprise.</li>
</ul>
<h4>Core Dimensions</h4>
<ul>
  <li>👥 <strong>People</strong><br>Culture, behaviors, ownership, and incentives for knowledge sharing and reuse.</li>
  <li>🔄 <strong>Process</strong><br>Workflows and practices for capturing, curating, and applying knowledge.</li>
  <li>💻 <strong>Technology</strong><br>Tools, platforms, and infrastructure that enable discovery, access, and AI readiness.</li>
  <li>🛡️ <strong>Governance</strong><br>Standards, policies, roles, and accountability that ensure trust, quality, and compliance.</li>
</ul>`,
    heroImage: wixImg("b805ce_c47dfecd3ac74431be4ec2e9b2e234ea~mv2.jpeg"),
    launchUrl: "https://orion.synozur.com/kmmm",
    pillar: "technology",
    publishedAt: new Date("2026-02-15T22:09:19Z"),
    featured: true,
    featuredRank: 5,
    seoTitle: "Knowledge Management Maturity Model — Assess Your KM Capabilities",
    seoDescription:
      "Benchmark your KM maturity across People, Process, Technology, and Governance. APQC, CMMI, and ISO 30401 aligned. Free assessment with instant score and PDF report.",
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const m of MODELS) {
    const existing = await db.query.modelsTable.findFirst({
      where: eq(modelsTable.slug, m.slug),
    });

    const values = {
      title: m.title,
      shortDescription: m.shortDescription,
      longDescriptionHtml: m.longDescriptionHtml,
      dimensionsHtml: m.dimensionsHtml,
      heroImage: m.heroImage,
      launchUrl: m.launchUrl,
      pillar: m.pillar,
      publishedAt: m.publishedAt,
      featured: m.featured,
      featuredRank: m.featuredRank,
      seoTitle: m.seoTitle,
      seoDescription: m.seoDescription,
      status: "published" as const,
      active: true,
    };

    let row;
    if (existing) {
      const [r] = await db
        .update(modelsTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(modelsTable.id, existing.id))
        .returning();
      row = r!;
      updated++;
      console.log(`  Updated: ${m.title}`);
    } else {
      const [r] = await db
        .insert(modelsTable)
        .values({ slug: m.slug, ...values })
        .returning();
      row = r!;
      created++;
      console.log(`  Created: ${m.title}`);
    }

    await upsertCollateralFromModel(row);
  }

  console.log(`\nModels seed: ${created} created, ${updated} updated — all synced to collateral.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
