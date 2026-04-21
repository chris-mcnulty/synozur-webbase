/**
 * Seed the three small DB-backed content tables used by the About page,
 * the /clients testimonial rail, and the /partners list (#104).
 *
 * Data comes from the hardcoded JSX defaults currently baked into
 * `artifacts/synozur/src/pages/{about,clients,partners}.tsx`. Those
 * pages continue to fall back to their hardcoded arrays when the DB is
 * empty, so running this seed is a one-time opt-in, not a hard
 * requirement.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedAboutContent.ts
 *
 * Idempotent: upserts by `slug`.
 */
import { eq } from "drizzle-orm";
import {
  db,
  aboutValuesTable,
  clientTestimonialsTable,
  partnerDescriptionsTable,
} from "@workspace/db";

const VALUES = [
  {
    slug: "ethical",
    title: "Ethical",
    body: "We have an unwavering commitment to operating with the highest ethical standards in all our actions and decisions — ensuring fairness and respect.",
    icon: "Shield",
  },
  {
    slug: "inclusive",
    title: "Inclusive",
    body: "We provide a sense of wellbeing, belonging, and community to our employees, our customers, and the communities we serve.",
    icon: "Users",
  },
  {
    slug: "honesty-integrity",
    title: "Honesty & Integrity",
    body: "We live by our word, and we will always do the right thing, even when it's hard.",
    icon: "HeartHandshake",
  },
  {
    slug: "human-centric",
    title: "Human-Centric",
    body: "Success lies in understanding and prioritizing the needs, aspirations, and well-being of the people involved. Our approach is rooted in empathy, active listening, and genuine collaboration.",
    icon: "Fingerprint",
  },
  {
    slug: "entrepreneurial",
    title: "Entrepreneurial",
    body: "We embody the entrepreneurial spirit in everything we do.",
    icon: "Rocket",
  },
  {
    slug: "excellence",
    title: "Excellence",
    body: "Quality over speed. High standards and continuous improvement. Client satisfaction delivered with the highest level of professionalism and care.",
    icon: "Award",
  },
];

const TESTIMONIALS = [
  {
    slug: "luxury-manufacturer",
    quote:
      "Our journey with the Company Operating System has truly transformed the way we operate and lead. The clear focus on priorities and performance metrics have empowered us to make strategic decisions more effectively.",
    authorName: "Senior leader",
    organization: "North American luxury manufacturer",
  },
  {
    slug: "energy-company",
    quote:
      "Synozur's impact through this project has truly revolutionized how our employees interact and collaborate, positioning us for greater innovation and success.",
    authorName: "Vice President of Digital Collaboration",
    organization: "North American Energy Company",
  },
  {
    slug: "microsoft-pmg",
    quote:
      "The team finally had a shared way to plan, measure, and adjust together — instead of reinventing the playbook every quarter.",
    authorName: "Product Marketing Group leader",
    organization: "Microsoft Modern Work",
  },
];

const PARTNERS = [
  {
    slug: "microsoft",
    name: "Microsoft",
    description:
      "We help organizations get the most from the Microsoft ecosystem — and help Microsoft partners build durable businesses on top of it. Strategy, offers, GTM, and field enablement.",
    logo: null,
    websiteUrl: "https://partner.microsoft.com",
    category: "primary",
  },
  {
    slug: "protiviti",
    name: "Protiviti",
    description:
      "Global consulting firm. We partner with Protiviti on enterprise transformation engagements requiring deep risk, internal audit, and technology consulting expertise.",
    logo: "/images/logos/protiviti.svg",
    websiteUrl: "https://www.protiviti.com",
    category: "alliance",
  },
  {
    slug: "ps-hummingbird",
    name: "ps hummingbird",
    description:
      "Specialized implementation partner for modern workplace and collaboration programs. We work with ps hummingbird when delivery calls for deep Microsoft 365 implementation muscle.",
    logo: "/images/logos/ps-hummingbird.png",
    websiteUrl: "https://www.pshummingbird.com",
    category: "alliance",
  },
  {
    slug: "creospark",
    name: "Creospark",
    description:
      "Boutique Microsoft-focused consultancy. We partner with Creospark where the engagement calls for specialized expertise in communications, adoption, and intranet modernization.",
    logo: "/images/logos/creospark.png",
    websiteUrl: "https://creospark.com",
    category: "alliance",
  },
];

async function upsertValues() {
  let created = 0;
  let updated = 0;
  for (let i = 0; i < VALUES.length; i++) {
    const v = VALUES[i];
    const existing = await db.query.aboutValuesTable.findFirst({
      where: eq(aboutValuesTable.slug, v.slug),
    });
    const values = {
      slug: v.slug,
      title: v.title,
      body: v.body,
      icon: v.icon,
      displayOrder: (i + 1) * 10,
      active: true,
    };
    if (existing) {
      await db
        .update(aboutValuesTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(aboutValuesTable.id, existing.id));
      updated++;
    } else {
      await db.insert(aboutValuesTable).values(values);
      created++;
    }
  }
  console.log(`About values: ${created} created, ${updated} updated.`);
}

async function upsertTestimonials() {
  let created = 0;
  let updated = 0;
  for (let i = 0; i < TESTIMONIALS.length; i++) {
    const t = TESTIMONIALS[i];
    const existing = await db.query.clientTestimonialsTable.findFirst({
      where: eq(clientTestimonialsTable.slug, t.slug),
    });
    const values = {
      slug: t.slug,
      quote: t.quote,
      authorName: t.authorName,
      organization: t.organization,
      displayOrder: (i + 1) * 10,
      active: true,
    };
    if (existing) {
      await db
        .update(clientTestimonialsTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(clientTestimonialsTable.id, existing.id));
      updated++;
    } else {
      await db.insert(clientTestimonialsTable).values(values);
      created++;
    }
  }
  console.log(`Client testimonials: ${created} created, ${updated} updated.`);
}

async function upsertPartners() {
  let created = 0;
  let updated = 0;
  for (let i = 0; i < PARTNERS.length; i++) {
    const p = PARTNERS[i];
    const existing = await db.query.partnerDescriptionsTable.findFirst({
      where: eq(partnerDescriptionsTable.slug, p.slug),
    });
    const values = {
      slug: p.slug,
      name: p.name,
      description: p.description,
      logo: p.logo,
      websiteUrl: p.websiteUrl,
      category: p.category,
      displayOrder: (i + 1) * 10,
      active: true,
    };
    if (existing) {
      await db
        .update(partnerDescriptionsTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(partnerDescriptionsTable.id, existing.id));
      updated++;
    } else {
      await db.insert(partnerDescriptionsTable).values(values);
      created++;
    }
  }
  console.log(`Partner descriptions: ${created} created, ${updated} updated.`);
}

async function main() {
  await upsertValues();
  await upsertTestimonials();
  await upsertPartners();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
