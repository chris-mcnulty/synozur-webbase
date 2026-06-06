// Shared Zod sub-schemas for the experiments / A/B testing API.
// The endpoints themselves now live in openapi.yaml and orval emits
// per-operation schemas under ./generated/api (e.g.
// GetActiveExperimentsResponse, PostExperimentAssignmentBody, etc.);
// this file exists because orval inlines shared component schemas
// rather than emitting them as standalone exports, so reusable
// pieces like OverrideMap, ConversionPath, PartnerItem, BookingLink,
// PublicExperiment(Variant), AdminExperiment(Variant) are kept here
// and re-exported alongside the generated barrel via fix-zod-index.mjs.
// MUST stay in sync with the matching components.schemas in
// openapi.yaml; the spec is the contract, this file is the
// runtime mirror.
import { z } from "zod";

// -- Status & state machine ------------------------------------------------

export const ExperimentStatus = z.enum(["draft", "running", "paused", "ended"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

// -- Override schema -------------------------------------------------------

// Each override key has a documented type. Unknown keys pass through
// (catchall: unknown) so a deploy that doesn't know about a newer key
// can still serve the variant — the runtime ignores keys it doesn't
// look up.
export const PartnerItem = z.object({
  src: z.string().min(1).max(2048),
  alt: z.string().max(200).default(""),
  href: z.string().max(2048).optional().nullable(),
});
export type PartnerItem = z.infer<typeof PartnerItem>;

export const BookingLink = z.object({
  label: z.string().min(1).max(120),
  href: z.string().min(1).max(2048),
  // Event id fired on click — the bridge between the link and the
  // experiment's conversionPaths config.
  eventId: z.string().min(1).max(80),
});
export type BookingLink = z.infer<typeof BookingLink>;

// Flat keyed map. Keys are namespace.dot.path.
export const OverrideMap = z
  .object({
    // Home page layout selector. true renders Home B at /;
    // false or absent follows the site-settings homeRootVariant toggle.
    "home.layout": z.boolean().optional(),

    // Hero — positioning headline
    "home.hero.positioning.visible": z.boolean().optional(),
    "home.hero.positioning.text": z.string().max(500).optional(),
    "home.hero.positioning.accentWord": z.string().max(80).optional(),

    // Hero — tagline / narrative
    "home.hero.tagline.text": z.string().max(1000).optional(),
    "home.hero.narrative.text": z.string().max(4000).optional(),

    // Hero — Get Started CTA
    "home.hero.cta.visible": z.boolean().optional(),
    "home.hero.cta.label": z.string().max(80).optional(),
    "home.hero.cta.href": z.string().max(2048).optional(),

    // Partners / "Trusted by"
    "home.partners.visible": z.boolean().optional(),
    "home.partners.heading": z.string().max(200).optional(),
    "home.partners.subtext": z.string().max(500).optional(),
    "home.partners.items": z.array(PartnerItem).max(50).optional(),

    // Booking links block (sits below the partners row)
    "home.booking.visible": z.boolean().optional(),
    "home.booking.heading": z.string().max(200).optional(),
    "home.booking.links": z.array(BookingLink).max(10).optional(),

    // Header upper-right CTA (signed-out)
    "header.cta.visible": z.boolean().optional(),
    "header.cta.label": z.string().max(80).optional(),
    "header.cta.href": z.string().max(2048).optional(),

    // /services-overview hero (page key: "services")
    "services.hero.eyebrow": z.string().max(80).optional(),
    "services.hero.headline": z.string().max(200).optional(),
    "services.hero.body": z.string().max(2000).optional(),

    // /applications hero (page key: "applications")
    "applications.hero.eyebrow": z.string().max(80).optional(),
    "applications.hero.headline": z.string().max(200).optional(),
    "applications.hero.body": z.string().max(2000).optional(),

    // /case-studies hero (page key: "case-studies")
    "case-studies.hero.eyebrow": z.string().max(80).optional(),
    "case-studies.hero.headline": z.string().max(200).optional(),
    "case-studies.hero.body": z.string().max(2000).optional(),

    // Home — Method aside copy (experiment engine: home.method.aside.*)
    "home.method.aside.headline": z.string().max(200).optional(),
    "home.method.aside.body": z.string().max(1000).optional(),
    "home.method.aside.cta": z.string().max(80).optional(),
    "home.method.aside.ctaHref": z.string().max(2048).optional(),

    // Home — client social-proof band (case-study pull-quotes + metrics).
    // The band itself only renders when a published case study has a quote;
    // these control its visibility and framing copy.
    "home.socialProof.visible": z.boolean().optional(),
    "home.socialProof.eyebrow": z.string().max(80).optional(),
    "home.socialProof.heading": z.string().max(200).optional(),

    // /trust Trust & Security page (page key: "trust")
    "trust.hero.eyebrow": z.string().max(80).optional(),
    "trust.hero.headline": z.string().max(200).optional(),
    "trust.hero.body": z.string().max(2000).optional(),
    "trust.cta.visible": z.boolean().optional(),
    "trust.cta.heading": z.string().max(200).optional(),
    "trust.cta.label": z.string().max(80).optional(),
    "trust.cta.href": z.string().max(2048).optional(),
  })
  .catchall(z.unknown());
export type OverrideMap = z.infer<typeof OverrideMap>;

// -- Conversion paths ------------------------------------------------------

export const ConversionPath = z.object({
  // "cta" — fires on a CTA event (eventId match in event properties)
  // "booking" — same shape as cta but separated for reporting clarity
  // "path" — fires on navigation to a path that startsWith(value)
  kind: z.enum(["cta", "booking", "path", "carousel"]),
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(120),
});
export type ConversionPath = z.infer<typeof ConversionPath>;

// -- Public read shapes (returned by /api/experiments/active) -------------

export const PublicExperimentVariant = z.object({
  key: z.string(),
  name: z.string(),
  isControl: z.boolean(),
  weight: z.number().int().min(0).max(100),
  overrides: OverrideMap,
});
export type PublicExperimentVariant = z.infer<typeof PublicExperimentVariant>;

export const PublicExperiment = z.object({
  key: z.string(),
  pageKey: z.string(),
  trafficPercentage: z.number().int().min(0).max(100),
  // Of in-test visitors, the % routed to a synthetic "_holdback" bucket.
  holdbackPercentage: z.number().int().min(0).max(100).default(0),
  conversionPaths: z.array(ConversionPath),
  variants: z.array(PublicExperimentVariant).min(1),
});
export type PublicExperiment = z.infer<typeof PublicExperiment>;

// -- Admin shapes ---------------------------------------------------------

export const AdminExperimentVariant = PublicExperimentVariant.extend({
  id: z.string().uuid(),
  experimentId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminExperimentVariant = z.infer<typeof AdminExperimentVariant>;

export const AdminExperiment = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  pageKey: z.string(),
  status: ExperimentStatus,
  trafficPercentage: z.number().int().min(0).max(100),
  holdbackPercentage: z.number().int().min(0).max(100).default(0),
  conversionPaths: z.array(ConversionPath),
  autoStopAfterDays: z.number().int().min(1).max(365).nullable(),
  autoStopOnSignificance: z.boolean().default(false),
  minVisitorsForAutoStop: z.number().int().min(0).default(1000),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  variants: z.array(AdminExperimentVariant),
});
export type AdminExperiment = z.infer<typeof AdminExperiment>;

// Body/response Zod schemas for the experiments endpoints are
// generated by orval from openapi.yaml. Use these names from
// lib/api-zod's barrel:
//   - PostExperimentAssignmentBody / PostExperimentAssignmentResponse
//   - GetActiveExperimentsResponse
//   - ListAdminExperimentsResponse / GetAdminExperimentResponse
//   - CreateAdminExperimentBody / UpdateAdminExperimentBody
//   - CreateAdminExperimentVariantBody / UpdateAdminExperimentVariantBody
//   - GetAdminExperimentResultsResponse
// The shapes above (AdminExperiment, AdminExperimentVariant,
// PublicExperiment, etc.) remain hand-written so route handlers can
// shape responses against the same TS types the admin UI consumes.

// -- Results --------------------------------------------------------------

export const VariantResult = z.object({
  key: z.string(),
  name: z.string(),
  isControl: z.boolean(),
  visitors: z.number().int().min(0),
  conversions: z.array(
    z.object({
      label: z.string(),
      kind: z.enum(["cta", "booking", "path", "carousel"]),
      value: z.string(),
      count: z.number().int().min(0),
      rate: z.number().min(0).max(1),
    }),
  ),
  overall: z.object({
    count: z.number().int().min(0),
    rate: z.number().min(0).max(1),
  }),
  significance: z
    .object({
      vsControl: z.number(),
      pValue: z.number(),
    })
    .optional(),
});

// GetAdminExperimentResultsResponse is generated by orval from the
// openapi.yaml /admin/experiments/{id}/results path; route handlers
// shape their response object against `VariantResult` above.
