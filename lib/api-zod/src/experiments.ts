// Hand-written Zod schemas for the experiments / A/B testing API. Sits
// alongside the orval-generated schemas; not regenerated. The OpenAPI
// spec doesn't yet describe these endpoints — when it does, this file
// can be replaced with the generated equivalents.
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
  })
  .catchall(z.unknown());
export type OverrideMap = z.infer<typeof OverrideMap>;

// -- Conversion paths ------------------------------------------------------

export const ConversionPath = z.object({
  // "cta" — fires on a CTA event (eventId match in event properties)
  // "booking" — same shape as cta but separated for reporting clarity
  // "path" — fires on navigation to a path that startsWith(value)
  kind: z.enum(["cta", "booking", "path"]),
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

export const GetActiveExperimentsResponse = z.object({
  experiments: z.array(PublicExperiment),
  generatedAt: z.string(),
});
export type GetActiveExperimentsResponse = z.infer<
  typeof GetActiveExperimentsResponse
>;

// Visitor → server: record an assignment. Idempotent.
export const PostAssignmentBody = z.object({
  experimentKey: z.string().min(1).max(80),
  variantKey: z.string().min(1).max(40),
  visitorId: z.string().min(1).max(64),
  forcedBy: z.enum(["url", "admin_preview"]).optional().nullable(),
});
export type PostAssignmentBody = z.infer<typeof PostAssignmentBody>;

export const PostAssignmentResponse = z.object({
  ok: z.boolean(),
});

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

export const ListAdminExperimentsResponse = z.object({
  experiments: z.array(AdminExperiment),
});
export type ListAdminExperimentsResponse = z.infer<
  typeof ListAdminExperimentsResponse
>;

// Stable identifier validation. Lower-snake-case-ish, also allows digits
// and hyphens. Avoid colons because ?_exp uses ":" as the separator.
const KEY_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export const CreateExperimentBody = z.object({
  key: z.string().min(1).max(80).regex(KEY_REGEX),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  pageKey: z.string().min(1).max(80),
  trafficPercentage: z.number().int().min(0).max(100).default(100),
  holdbackPercentage: z.number().int().min(0).max(100).default(0),
  conversionPaths: z.array(ConversionPath).default([]),
});
export type CreateExperimentBody = z.infer<typeof CreateExperimentBody>;

export const UpdateExperimentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  trafficPercentage: z.number().int().min(0).max(100).optional(),
  holdbackPercentage: z.number().int().min(0).max(100).optional(),
  conversionPaths: z.array(ConversionPath).optional(),
  autoStopAfterDays: z.number().int().min(1).max(365).nullable().optional(),
  autoStopOnSignificance: z.boolean().optional(),
  minVisitorsForAutoStop: z.number().int().min(0).optional(),
});
export type UpdateExperimentBody = z.infer<typeof UpdateExperimentBody>;

const VARIANT_KEY_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export const CreateVariantBody = z.object({
  key: z.string().min(1).max(40).regex(VARIANT_KEY_REGEX),
  name: z.string().min(1).max(120),
  isControl: z.boolean().default(false),
  weight: z.number().int().min(0).max(100),
  overrides: OverrideMap.default({}),
});
export type CreateVariantBody = z.infer<typeof CreateVariantBody>;

export const UpdateVariantBody = z.object({
  name: z.string().min(1).max(120).optional(),
  isControl: z.boolean().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  overrides: OverrideMap.optional(),
});
export type UpdateVariantBody = z.infer<typeof UpdateVariantBody>;

// -- Results --------------------------------------------------------------

export const VariantResult = z.object({
  key: z.string(),
  name: z.string(),
  isControl: z.boolean(),
  visitors: z.number().int().min(0),
  conversions: z.array(
    z.object({
      label: z.string(),
      kind: z.enum(["cta", "booking", "path"]),
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

export const GetExperimentResultsResponse = z.object({
  experimentId: z.string().uuid(),
  variants: z.array(VariantResult),
});
export type GetExperimentResultsResponse = z.infer<
  typeof GetExperimentResultsResponse
>;
