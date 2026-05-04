import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  postsTable,
  usersTable,
  mediaTable,
  categoriesTable,
  tagsTable,
  postCategories,
  postTags,
  teamMembersTable,
} from "@workspace/db";

export type SerializedPost = ReturnType<typeof shape>;

type AuthorTeamMember = {
  jobTitle: string;
  linkedinUrl: string | null;
  slug: string;
  imageUrl: string | null;
} | null;

function shape(args: {
  post: typeof postsTable.$inferSelect;
  author: { id: string; displayName: string | null; avatarUrl: string | null; bio: string | null } | null;
  authorTeamMember: AuthorTeamMember;
  hero: { publicUrl: string } | null;
  og: { publicUrl: string } | null;
  categories: { id: string; slug: string; name: string; description: string | null }[];
  tags: { id: string; slug: string; name: string }[];
}) {
  const { post, author, authorTeamMember, hero, og, categories, tags } = args;
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    subtitle: post.subtitle,
    bodyHtml: post.bodyHtml,
    bodyMarkdown: post.bodyMarkdown,
    excerpt: post.excerpt,
    heroImageUrl: hero?.publicUrl ?? null,
    ogImageUrl: og?.publicUrl ?? null,
    authorId: post.authorId,
    author: author
      ? {
          id: author.id,
          displayName: author.displayName,
          // Prefer the team member's professional headshot over the SSO avatar,
          // but only when the team member record is active (link is non-null here).
          avatarUrl: authorTeamMember?.imageUrl ?? author.avatarUrl,
          bio: author.bio,
          jobTitle: authorTeamMember?.jobTitle ?? null,
          linkedinUrl: authorTeamMember?.linkedinUrl ?? null,
          // Null when the author has no linked team member or has gone inactive.
          teamMemberSlug: authorTeamMember?.slug ?? null,
        }
      : {
          id: post.authorId,
          displayName: null,
          avatarUrl: null,
          bio: null,
          jobTitle: null,
          linkedinUrl: null,
          teamMemberSlug: null,
        },
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    seoCanonicalUrl: post.seoCanonicalUrl,
    readingTimeMin: post.readingTimeMin,
    featured: post.featured,
    featuredRank: post.featuredRank,
    linkedSolutionId: post.linkedSolutionId ?? null,
    categories,
    tags,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export async function serializePosts(
  posts: (typeof postsTable.$inferSelect)[],
): Promise<SerializedPost[]> {
  if (posts.length === 0) return [];

  const authorIds = Array.from(new Set(posts.map((p) => p.authorId)));
  const mediaIds = Array.from(
    new Set(
      posts
        .flatMap((p) => [p.heroImageId, p.ogImageId])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const postIds = posts.map((p) => p.id);

  const [authors, teamMembers, media, pcRows, ptRows] = await Promise.all([
    authorIds.length
      ? db
          .select({
            id: usersTable.id,
            displayName: usersTable.displayName,
            avatarUrl: usersTable.avatarUrl,
            bio: usersTable.bio,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, authorIds))
      : Promise.resolve([]),
    // Only join active team members — inactive (departed) authors lose the
    // profile link and job title on live pages without touching their posts.
    authorIds.length
      ? db
          .select({
            userId: teamMembersTable.userId,
            jobTitle: teamMembersTable.jobTitle,
            linkedinUrl: teamMembersTable.linkedinUrl,
            slug: teamMembersTable.slug,
            imageUrl: teamMembersTable.imageUrl,
          })
          .from(teamMembersTable)
          .where(
            and(
              inArray(teamMembersTable.userId, authorIds),
              eq(teamMembersTable.active, true),
            ),
          )
      : Promise.resolve(
          [] as Array<{
            userId: string | null;
            jobTitle: string;
            linkedinUrl: string | null;
            slug: string;
            imageUrl: string | null;
          }>,
        ),
    mediaIds.length
      ? db
          .select({ id: mediaTable.id, publicUrl: mediaTable.publicUrl })
          .from(mediaTable)
          .where(inArray(mediaTable.id, mediaIds))
      : Promise.resolve([]),
    postIds.length
      ? db
          .select({
            postId: postCategories.postId,
            id: categoriesTable.id,
            slug: categoriesTable.slug,
            name: categoriesTable.name,
            description: categoriesTable.description,
          })
          .from(postCategories)
          .innerJoin(categoriesTable, eq(postCategories.categoryId, categoriesTable.id))
          .where(inArray(postCategories.postId, postIds))
      : Promise.resolve([]),
    postIds.length
      ? db
          .select({
            postId: postTags.postId,
            id: tagsTable.id,
            slug: tagsTable.slug,
            name: tagsTable.name,
          })
          .from(postTags)
          .innerJoin(tagsTable, eq(postTags.tagId, tagsTable.id))
          .where(inArray(postTags.postId, postIds))
      : Promise.resolve([]),
  ]);

  const authorMap = new Map(authors.map((a) => [a.id, a]));
  const teamMemberMap = new Map(
    teamMembers
      .filter((tm): tm is typeof tm & { userId: string } => tm.userId != null)
      .map((tm) => [tm.userId, tm]),
  );
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const catMap = new Map<string, { id: string; slug: string; name: string; description: string | null }[]>();
  for (const row of pcRows) {
    const arr = catMap.get(row.postId) ?? [];
    arr.push({ id: row.id, slug: row.slug, name: row.name, description: row.description });
    catMap.set(row.postId, arr);
  }
  const tagMap = new Map<string, { id: string; slug: string; name: string }[]>();
  for (const row of ptRows) {
    const arr = tagMap.get(row.postId) ?? [];
    arr.push({ id: row.id, slug: row.slug, name: row.name });
    tagMap.set(row.postId, arr);
  }

  return posts.map((post) =>
    shape({
      post,
      author: authorMap.get(post.authorId) ?? null,
      authorTeamMember: teamMemberMap.get(post.authorId) ?? null,
      hero: post.heroImageId ? mediaMap.get(post.heroImageId) ?? null : null,
      og: post.ogImageId ? mediaMap.get(post.ogImageId) ?? null : null,
      categories: catMap.get(post.id) ?? [],
      tags: tagMap.get(post.id) ?? [],
    }),
  );
}

export async function serializePost(
  post: typeof postsTable.$inferSelect,
): Promise<SerializedPost> {
  const [out] = await serializePosts([post]);
  return out;
}
