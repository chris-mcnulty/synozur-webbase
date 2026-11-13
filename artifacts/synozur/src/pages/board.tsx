import { Link } from "wouter";
import { motion } from "framer-motion";
import { Linkedin, Lock } from "lucide-react";
import { useListBoard, type BoardProfile } from "@workspace/api-client-react";
import { Meta } from "@/lib/meta";
import { PageHero } from "@/components/layout/page-hero";
import NotFound from "@/pages/not-found";
import {
  BOARD_REQUEST,
  BOARD_STATUS_POLL_MS,
  errStatus,
  resolveImageUrl,
  safeHref,
  stripHtml,
  useBoardStatus,
} from "@/lib/board";

export function PrivateBoardBanner() {
  return (
    <div
      className="bg-primary/10 border-b border-primary/30 text-sm"
      data-testid="banner-board-private"
    >
      <div className="container mx-auto px-4 max-w-7xl py-3 flex items-center gap-2 text-foreground">
        <Lock className="h-4 w-4 text-primary shrink-0" />
        <span>
          Admin preview. The Board of Advisors is restricted to admins — visitors
          cannot see this page, and it is hidden from navigation and search.
        </span>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8" data-testid="board-loading">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-square rounded-full bg-muted mx-auto max-w-[220px] mb-5" />
          <div className="h-5 w-2/3 bg-muted rounded mb-2" />
          <div className="h-4 w-1/2 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

function BoardGrid({ people, testId }: { people: BoardProfile[]; testId: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8" data-testid={testId}>
      {people.map((p, i) => {
        const bio = stripHtml(p.shortDescription);
        const imageSrc = resolveImageUrl(p.imageUrl);
        const li = safeHref(p.linkedinUrl);
        return (
          <motion.article
            key={p.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.05 }}
            className="group"
            data-testid={`board-card-${p.slug}`}
          >
            <Link
              href={`/board/${encodeURIComponent(p.slug)}`}
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
            >
              <div className="relative aspect-square rounded-full overflow-hidden bg-card mb-5 border border-border/50 mx-auto max-w-[220px]">
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt={p.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    {p.name}
                  </div>
                )}
              </div>
              <h3 className="text-xl font-bold leading-tight group-hover:text-primary transition-colors">
                {p.name}
              </h3>
              {p.jobTitle && <p className="text-lg text-primary mb-3">{p.jobTitle}</p>}
              {bio && (
                <p className="text-lg text-muted-foreground leading-relaxed mb-4">{bio}</p>
              )}
            </Link>
            {li && (
              <a
                href={li}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                aria-label={`${p.name} on LinkedIn`}
              >
                <Linkedin className="h-4 w-4" /> LinkedIn
              </a>
            )}
          </motion.article>
        );
      })}
    </div>
  );
}

export default function Board() {
  const s = useBoardStatus();

  const listQ = useListBoard({
    query: {
      queryKey: s.key("list"),
      enabled: s.canView,
      staleTime: 0,
      gcTime: 0,
      refetchInterval: BOARD_STATUS_POLL_MS,
      retry: (n, err) => ![401, 403, 404].includes(errStatus(err) ?? 0) && n < 2,
    },
    request: BOARD_REQUEST,
  });

  if (!s.isLoaded || (!s.isAdmin && s.statusQ.isLoading)) {
    return (
      <div className="w-full">
        <Meta title="Board of Advisors" noindex />
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 max-w-7xl">
            <BoardSkeleton />
          </div>
        </section>
      </div>
    );
  }

  if (!s.canView) {
    return (
      <>
        <Meta title="Not found" noindex />
        <NotFound />
      </>
    );
  }

  const roster = listQ.data;
  // Never render items if the server (or a later poll) says private and we
  // are not an admin.
  const items =
    !listQ.isError && roster && ((roster.public && s.isPublic) || s.isAdmin) ? roster.items : [];
  const isPrivate = !s.isPublic || roster?.public === false;
  const external = items.filter((p) => p.group === "external");
  const internal = items.filter((p) => p.group === "internal");

  return (
    <div className="w-full">
      <Meta
        title="Board of Advisors"
        description="The independent advisors and Synozur leaders who counsel The Synozur Alliance."
        noindex={isPrivate}
      />
      <PageHero
        eyebrow="Board of Advisors"
        title="Board of Advisors"
        subtitle="Our Board of Advisors brings outside perspective to the work we do with executive teams — seasoned leaders who challenge our thinking and keep us honest."
        data-testid="board-hero"
      />
      {isPrivate && <PrivateBoardBanner />}

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 max-w-7xl">
          {listQ.isLoading ? (
            <BoardSkeleton />
          ) : listQ.isError ? (
            <div className="text-center py-16" data-testid="board-error">
              <p className="text-muted-foreground mb-4">
                The board roster could not be loaded.
              </p>
              <button
                onClick={() => listQ.refetch()}
                className="inline-flex h-10 items-center rounded-md border border-border px-5 text-sm hover:border-primary hover:text-primary transition-colors"
                data-testid="button-board-retry"
              >
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 max-w-xl mx-auto" data-testid="board-empty">
              <p className="text-sm uppercase tracking-widest text-primary mb-3">Board of Advisors</p>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">Announcements to come.</h2>
              <p className="text-muted-foreground">
                Our advisors will be introduced here shortly.
              </p>
            </div>
          ) : (
            <div className="space-y-24">
              {external.length > 0 && (
                <div>
                  <p className="text-sm uppercase tracking-widest text-primary mb-3">Advisors</p>
                  <h2 className="text-3xl md:text-4xl font-bold mb-12">Independent advisors</h2>
                  <BoardGrid people={external} testId="board-grid-external" />
                </div>
              )}
              {internal.length > 0 && (
                <div>
                  <p className="text-sm uppercase tracking-widest text-primary mb-3">Synozur</p>
                  <h2 className="text-3xl md:text-4xl font-bold mb-12">From the Synozur team</h2>
                  <BoardGrid people={internal} testId="board-grid-internal" />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="py-24 bg-card border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Meet the people doing the work.</h2>
          <p className="text-lg text-muted-foreground mb-8">
            Our advisors shape the thinking. Our partners sit alongside your team.
          </p>
          <Link
            href="/team"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            data-testid="link-board-team"
          >
            Meet the team
          </Link>
        </div>
      </section>
    </div>
  );
}
