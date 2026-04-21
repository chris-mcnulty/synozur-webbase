/**
 * Seed the workshops table from the static content file in the synozur app.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedWorkshops.ts
 *
 * Idempotent: upserts by slug.
 */
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { db, workshopsTable, servicesTable } from "@workspace/db";

type CTA = { label: string; href: string };
type FAQItem = { q: string; a: string };

type StaticWorkshop = {
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
  competitiveIntel?: { header: string; summary: string; outputs: string[] };
  toolingNote?: string;
  outcomes: { header: string; bullets: string[] };
  beforeExample: string;
  afterExample: string;
  sampleDeliverables: { header: string; link?: string; thumbs: string[] };
  faq: { header: string; items: FAQItem[] };
  seo: { title: string; description: string };
};

async function loadWorkshops(): Promise<StaticWorkshop[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  // artifacts/api-server/src/scripts → artifacts/synozur/src/data/workshops.ts
  const filePath = resolve(here, "../../../synozur/src/data/workshops.ts");
  const mod = (await import(pathToFileURL(filePath).href)) as {
    workshops: StaticWorkshop[];
  };
  return mod.workshops;
}

function asValues(w: StaticWorkshop, displayOrder: number) {
  return {
    slug: w.slug,
    title: w.title,
    category: w.category,
    shortDescription: w.shortDescription,
    heroHeadline: w.heroHeadline,
    heroSubhead: w.heroSubhead,
    heroImage: w.heroImage,
    heroTrustBullets: w.heroTrustBullets,
    primaryCTA: w.primaryCTA,
    secondaryCTA: w.secondaryCTA ?? null,
    deliveryFormat: w.deliveryFormat,
    duration: w.duration,
    whoItsFor: w.whoItsFor,
    idealParticipants: w.idealParticipants,
    prerequisites: w.prerequisites,
    pain: w.pain,
    scope: w.scope,
    process: w.process,
    deliverables: w.deliverables,
    price: {
      label: w.price.label,
      startingAt: w.price.startingAt ?? null,
      display: w.price.display,
      timeline: w.price.timeline,
      whatIsIncluded: w.price.whatIsIncluded,
    },
    diagnostic: w.diagnostic
      ? {
          header: w.diagnostic.header,
          summary: w.diagnostic.summary,
          whatWeAssess: w.diagnostic.whatWeAssess,
          questionnairePreview: w.diagnostic.questionnairePreview,
          sampleOutputLink: w.diagnostic.sampleOutputLink ?? null,
        }
      : null,
    competitiveIntel: w.competitiveIntel ?? null,
    toolingNote: w.toolingNote ?? null,
    outcomes: w.outcomes,
    beforeExample: w.beforeExample,
    afterExample: w.afterExample,
    sampleDeliverables: {
      header: w.sampleDeliverables.header,
      link: w.sampleDeliverables.link ?? null,
      thumbs: w.sampleDeliverables.thumbs,
    },
    faq: w.faq,
    seo: w.seo,
    displayOrder,
    active: true,
    sourceId: w.slug,
  };
}

// Maps the per-workshop `category` label to a service slug. Replaces
// the former hand-maintained category-to-service lookup map in
// service-detail.tsx — the mapping now runs once at seed time and
// writes a real `workshops.service_id` FK (#100 / #105). Editors can
// reassign a workshop's service via admin CRUD afterwards.
const CATEGORY_TO_SERVICE_SLUG: Record<string, string> = {
  "AI Strategy & Design": "strategic-transformation",
  "Leadership & Organizational Transformation": "strategic-transformation",
  "Microsoft 365 Transformation": "technology-transformation",
  "Go-to-Market Transformation": "go-to-market-transformation",
};

async function loadServiceSlugToId(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: servicesTable.id, slug: servicesTable.slug })
    .from(servicesTable)
    .where(and(eq(servicesTable.active, true), isNull(servicesTable.deletedAt)));
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.slug, r.id);
  return out;
}

async function main(): Promise<void> {
  const workshops = await loadWorkshops();
  const serviceSlugToId = await loadServiceSlugToId();
  let created = 0;
  let updated = 0;

  for (let i = 0; i < workshops.length; i++) {
    const w = workshops[i];
    const values = asValues(w, (i + 1) * 10);
    const serviceSlug = CATEGORY_TO_SERVICE_SLUG[w.category];
    const serviceId = serviceSlug ? serviceSlugToId.get(serviceSlug) ?? null : null;
    (values as Record<string, unknown>).serviceId = serviceId;
    const existing = await db.query.workshopsTable.findFirst({
      where: eq(workshopsTable.slug, w.slug),
    });
    if (existing) {
      await db
        .update(workshopsTable)
        .set({ ...values, updatedAt: new Date(), deletedAt: null })
        .where(eq(workshopsTable.id, existing.id));
      updated++;
    } else {
      await db.insert(workshopsTable).values(values);
      created++;
    }
  }

  console.log(`Workshops seeded: ${created} created, ${updated} updated.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
