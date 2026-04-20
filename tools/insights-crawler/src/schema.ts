import { z } from "zod";

export const PostImageSchema = z.object({
  originalUrl: z.string().url(),
  localPath: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type PostImage = z.infer<typeof PostImageSchema>;

export const PostSchema = z.object({
  slug: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  excerpt: z.string().nullable(),
  authorName: z.string().nullable(),
  authorUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  readingTimeMinutes: z.number().int().nonnegative().nullable(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  heroImage: PostImageSchema.nullable(),
  bodyHtml: z.string(),
  bodyMarkdown: z.string(),
  bodyImages: z.array(PostImageSchema),
  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    ogImage: z.string().nullable(),
  }),
  status: z.enum(["ok", "partial", "failed"]),
  notes: z.array(z.string()),
});
export type Post = z.infer<typeof PostSchema>;

export const PostsFileSchema = z.array(PostSchema);
