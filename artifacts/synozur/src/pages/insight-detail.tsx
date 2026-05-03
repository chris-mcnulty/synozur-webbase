import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, MessageSquare } from "lucide-react";
import { Meta } from "@/lib/meta";
import { dynamicOgImageUrl } from "@/lib/og-image-url";
import { Button } from "@/components/ui/button";
import { ArticleJsonLd } from "@/components/article-jsonld";
import { ShareRail } from "@/components/share-rail";
import {
  useInsight,
  useInsightsList,
  resolveMediaUrl,
  resolveBodyHtml,
  buildMediaSrcSet,
} from "@/lib/insights";
import NotFound from "./not-found";
import { CommentThread } from "@/components/comments/comment-thread";
import {
  useListInsightComments,
  getListInsightCommentsQueryKey,
  trackInsightView,
} from "@workspace/api-client-react";
import type { PublicPost } from "@workspace/api-client-react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/**
 * A post is treated as a NewsArticle (rather than an Article) when it carries
 * a `news` tag or sits in a category whose slug or name reads as news. This is
 * a tag-driven opt-in so editors can route a post into Top Stories simply by
 * adding the tag — no schema migration needed.
 */
function isNewsPost(post: PublicPost): boolean {
  const matches = (s: string | null | undefined) =>
    !!s && /^news$/i.test(s.trim());
  if (post.tags?.some((t) => matches(t.slug) || matches(t.name))) return true;
  if (post.categories?.some((c) => matches(c.slug) || matches(c.name))) return true;
  return false;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// Related-rail thumbs sit in a 3-up grid inside max-w-6xl.
const RELATED_CARD_WIDTHS = [400, 600, 900] as const;
const RELATED_CARD_SIZES =
  "(min-width: 768px) 33vw, 100vw";

// Hero spans the max-w-5xl container — ≈1024px CSS, 2x for retina.
const HERO_WIDTHS = [768, 1024, 1280, 1600, 2048] as const;
const HERO_SIZES = "(min-width: 768px) min(64rem, 100vw - 2rem), 100vw";

function RelatedRail({ post }: { post: PublicPost }) {
  const categorySlug = post.categories?.[0]?.slug;
  const { data } = useInsightsList(
    categorySlug ? { categorySlug, page: 1, pageSize: 6 } : { page: 1, pageSize: 6 },
  );
  const related = (data?.items ?? []).filter((p) => p.id !== post.id).slice(0, 3);
  if (!related.length) return null;
  return (
    <section aria-label="Related posts" className="border-t border-border bg-card py-16">
      <div className="container mx-auto px-4 max-w-6xl">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">More from The Feed</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {related.map((p) => {
            const hero = resolveMediaUrl(p.heroImageUrl, { width: 600 });
            const heroSrcSet = buildMediaSrcSet(p.heroImageUrl, RELATED_CARD_WIDTHS);
            return (
              <Link
                key={p.id}
                href={`/insights/${p.slug}`}
                className="group rounded-2xl border border-border/60 bg-background overflow-hidden hover:border-primary/40 transition-colors block"
              >
                <div className="relative aspect-[16/9] overflow-hidden bg-card">
                  {hero ? (
                    <img
                      src={hero}
                      srcSet={heroSrcSet ?? undefined}
                      sizes={heroSrcSet ? RELATED_CARD_SIZES : undefined}
                      alt={p.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full nebula-gradient opacity-40" />
                  )}
                </div>
                <div className="p-5">
                  <p className="text-xs uppercase tracking-widest text-primary mb-2">
                    {p.categories?.[0]?.name ?? "Insight"}
                  </p>
                  <h3 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors">
                    {p.title}
                  </h3>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CommentCountChip({ slug }: { slug: string }) {
  const { data } = useListInsightComments(slug, {
    query: {
      queryKey: getListInsightCommentsQueryKey(slug),
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  });
  const count = data?.length ?? 0;
  return (
    <a
      href="#discussion"
      className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-primary transition-colors"
      data-testid="comment-count-chip"
    >
      <MessageSquare className="h-3.5 w-3.5" />
      <span>
        {count} comment{count === 1 ? "" : "s"}
      </span>
    </a>
  );
}

export default function InsightDetail() {
  const [, params] = useRoute("/insights/:slug");
  const slug = params?.slug ?? "";
  const { data: post, isLoading, isError, error } = useInsight(slug);

  // Scroll to top on slug change.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [slug]);

  // Fire view tracking once the post data is known.
  useEffect(() => {
    if (!post?.slug) return;
    const ref = document.referrer || null;
    trackInsightView(post.slug, { referrer: ref }).catch(() => {});
  }, [post?.slug]);

  const bodyHtml = useMemo(() => resolveBodyHtml(post?.bodyHtml), [post?.bodyHtml]);
  const hero = resolveMediaUrl(post?.heroImageUrl, { width: 1280 });
  const heroSrcSet = buildMediaSrcSet(post?.heroImageUrl, HERO_WIDTHS);
  // OG/social previews are consumed by external scrapers (Slack, X, FB) —
  // keep them at full resolution so unfurls don't pick a downscaled crop.
  const editorOgImage = resolveMediaUrl(post?.ogImageUrl) || resolveMediaUrl(post?.heroImageUrl);
  // Fall back to the dynamic OG image generator (#161) when editorial hasn't
  // uploaded an OG / hero image. Versioned by `updatedAt` so crawler caches
  // bust on edits; `Meta` resolves the relative URL against SITE_ORIGIN.
  const ogImage =
    editorOgImage ||
    dynamicOgImageUrl("insight", post?.id, post?.updatedAt) ||
    undefined;

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-32">
        <div className="max-w-3xl mx-auto animate-pulse space-y-6">
          <div className="h-4 w-32 bg-muted/40 rounded" />
          <div className="h-12 w-full bg-muted/40 rounded" />
          <div className="h-6 w-3/4 bg-muted/40 rounded" />
          <div className="aspect-[16/9] bg-muted/40 rounded-xl mt-8" />
        </div>
      </div>
    );
  }

  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) return <NotFound />;
    return (
      <div className="container mx-auto px-4 py-32 text-center">
        <p className="text-lg text-destructive mb-4">We couldn&apos;t load this post.</p>
        <Link href="/insights">
          <Button variant="outline">Back to The Feed</Button>
        </Link>
      </div>
    );
  }

  if (!post) return <NotFound />;

  const seoTitle = post.seoTitle || post.title;
  const seoDescription = post.seoDescription || post.excerpt || post.subtitle || undefined;

  return (
    <div className="w-full">
      <Meta
        title={seoTitle}
        description={seoDescription ?? undefined}
        path={`${BASE_PATH}/insights/${post.slug}`}
        image={ogImage}
        type="article"
        rawTitle={Boolean(post.seoTitle)}
        feedHref={`${BASE_PATH}/api/insights/rss.xml`}
      />

      <ArticleJsonLd
        slug={post.slug}
        title={post.title}
        description={seoDescription ?? null}
        image={ogImage ?? null}
        publishedAt={post.publishedAt ?? null}
        authorName={post.author?.displayName ?? null}
        isNews={isNewsPost(post)}
      />

      <article className="bg-background">
        <header className="relative overflow-hidden bg-[#0B0B1A] py-20 md:py-28">
          <div className="absolute inset-0 nebula-gradient opacity-25" />
          <div className="container relative z-10 mx-auto px-4 max-w-4xl">
            <Link
              href="/insights"
              className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-primary transition-colors mb-8"
            >
              <ArrowLeft className="h-4 w-4" /> Back to The Feed
            </Link>
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-widest text-zinc-300 mb-6">
              {post.categories?.[0] && (
                <>
                  <span className="text-primary">{post.categories[0].name}</span>
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                </>
              )}
              {post.author?.displayName && (
                <>
                  <span>{post.author.displayName}</span>
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                </>
              )}
              <span>{formatDate(post.publishedAt)}</span>
              {post.readingTimeMin && (
                <>
                  <span className="h-1 w-1 rounded-full bg-zinc-500" />
                  <span>{post.readingTimeMin} min read</span>
                </>
              )}
              <span className="h-1 w-1 rounded-full bg-zinc-500" />
              <CommentCountChip slug={post.slug} />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6 leading-tight">
              {post.title}
            </h1>
            {post.subtitle && (
              <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed">{post.subtitle}</p>
            )}
          </div>
        </header>

        {hero && (
          <div className="container mx-auto px-4 -mt-8 md:-mt-12 max-w-5xl relative z-10">
            <div className="aspect-[16/9] overflow-hidden rounded-2xl border border-border/60 shadow-2xl">
              <img
                src={hero}
                srcSet={heroSrcSet ?? undefined}
                sizes={heroSrcSet ? HERO_SIZES : undefined}
                alt={post.title}
                decoding="async"
                fetchPriority="high"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 max-w-3xl pt-10">
          <ShareRail kind="insight" title={post.title} className="" />
        </div>

        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl">
          {bodyHtml ? (
            <div
              className="prose dark:prose-invert prose-lg max-w-none prose-headings:font-bold prose-a:text-primary prose-img:rounded-xl prose-img:border prose-img:border-border/60"
              // Body HTML was sanitized at ingest time by the crawler (sanitize-html).
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : (
            <p className="text-muted-foreground">This post has no body yet.</p>
          )}

          {post.author?.displayName && (
            <aside className="mt-16 pt-10 border-t border-border flex items-start gap-4">
              {post.author.avatarUrl && (
                <img
                  src={resolveMediaUrl(post.author.avatarUrl, { width: 112 }) ?? undefined}
                  alt={post.author.displayName}
                  loading="lazy"
                  decoding="async"
                  width={56}
                  height={56}
                  className="w-14 h-14 rounded-full object-cover border border-border/60"
                />
              )}
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  Written by
                </p>
                <p className="text-lg font-semibold">{post.author.displayName}</p>
              </div>
            </aside>
          )}
        </div>
      </article>

      <CommentThread slug={post.slug} />

      <RelatedRail post={post} />

      <section className="bg-background border-t border-border py-20">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Subscribe to The Feed</h2>
          <p className="text-lg text-muted-foreground mb-6">
            New essays, models, and Polaris episodes — delivered to your inbox.
          </p>
          <Link href="/contact">
            <Button size="lg" className="px-8">
              Get on the list <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
