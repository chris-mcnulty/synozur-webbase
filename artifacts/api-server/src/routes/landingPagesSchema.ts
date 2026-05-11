/**
 * Wire-format Zod schemas for landing-page block payloads.
 *
 * Lives outside `routes/landingPages.ts` so a pure-validation unit test
 * can import the contract without booting Express or requiring a
 * DATABASE_URL. The route file re-exports `BlockSchema` for backward
 * compatibility with anything that imports from it.
 *
 * Adding a new block type:
 *   1. Extend LANDING_PAGE_BLOCK_TYPES in @workspace/db.
 *   2. Define a schema below with `type: z.literal("yourType")`.
 *   3. Add it to `BlockSchema`'s discriminatedUnion.
 *   4. Teach the public renderer + admin editor about the new shape.
 */

import { z } from "zod";

const HeroBlockSchema = z.object({
  type: z.literal("hero"),
  eyebrow: z.string().nullish(),
  title: z.string(),
  subtitle: z.string().nullish(),
  theme: z.enum(["nebula", "light"]).nullish(),
});

const RichTextBlockSchema = z.object({
  type: z.literal("richText"),
  heading: z.string().nullish(),
  bodyHtml: z.string(),
});

const CardGridCardSchema = z.object({
  code: z.string().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  level: z.string().nullish(),
  url: z.string().nullish(),
  source: z.string().nullish(),
});

const CardGridBlockSchema = z.object({
  type: z.literal("cardGrid"),
  heading: z.string().nullish(),
  intro: z.string().nullish(),
  cards: z.array(CardGridCardSchema),
});

const CtaButtonSchema = z.object({
  label: z.string(),
  href: z.string(),
  variant: z.enum(["primary", "secondary"]).optional(),
});

const CtaBlockSchema = z.object({
  type: z.literal("cta"),
  heading: z.string(),
  body: z.string().nullish(),
  buttons: z.array(CtaButtonSchema),
  theme: z.enum(["nebula", "light"]).nullish(),
});

const ImageBlockSchema = z.object({
  type: z.literal("image"),
  url: z.string(),
  alt: z.string().nullish(),
  caption: z.string().nullish(),
});

const FaqItemSchema = z.object({ q: z.string(), a: z.string() });

const FaqBlockSchema = z.object({
  type: z.literal("faq"),
  heading: z.string().nullish(),
  items: z.array(FaqItemSchema),
});

export const BlockSchema = z.discriminatedUnion("type", [
  HeroBlockSchema,
  RichTextBlockSchema,
  CardGridBlockSchema,
  CtaBlockSchema,
  ImageBlockSchema,
  FaqBlockSchema,
]);

export type LandingPageBlockInput = z.infer<typeof BlockSchema>;
