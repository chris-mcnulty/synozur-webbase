import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Globe, Linkedin, Mail, Mic2 } from "lucide-react";
import { useGetBoardProfile } from "@workspace/api-client-react";
import { Meta } from "@/lib/meta";
import NotFound from "@/pages/not-found";
import { RichText } from "@/components/rich-text";
import { PrivateBoardBanner } from "@/pages/board";
import {
  BOARD_REQUEST,
  BOARD_STATUS_POLL_MS,
  errStatus,
  resolveImageUrl,
  safeEmail,
  safeHref,
  stripHtml,
  useBoardStatus,
} from "@/lib/board";

const btn =
  "inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 text-sm text-white hover:bg-white/10 transition-colors";

export default function BoardDetail() {
  const [, params] = useRoute("/board/:slug");
  const slug = params?.slug ?? "";
  const s = useBoardStatus();

  const q = useGetBoardProfile(slug, {
    query: {
      queryKey: s.key("profile", slug),
      enabled: s.canView && slug.length > 0,
      staleTime: 0,
      gcTime: 0,
      refetchInterval: BOARD_STATUS_POLL_MS,
      retry: (n, err) => ![401, 403, 404].includes(errStatus(err) ?? 0) && n < 2,
    },
    request: BOARD_REQUEST,
  });

  if (!s.isLoaded || (!s.isAdmin && s.statusQ.isLoading) || (s.canView && q.isLoading)) {
    return (
      <div className="w-full">
        <Meta title="Board of Advisors" noindex />
        <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
          <div className="container mx-auto px-4 max-w-5xl grid grid-cols-1 md:grid-cols-5 gap-10 animate-pulse" data-testid="board-detail-loading">
            <div className="md:col-span-2 aspect-square rounded-2xl bg-white/5" />
            <div className="md:col-span-3 space-y-4">
              <div className="h-4 w-1/3 bg-white/10 rounded" />
              <div className="h-12 w-2/3 bg-white/10 rounded" />
              <div className="h-4 w-full bg-white/10 rounded" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!s.canView) {
    return (<><Meta title="Not found" noindex /><NotFound /></>);
  }

  if (q.isError) {
    const st = errStatus(q.error);
    if (st === 404 || st === 403 || st === 401) {
      return (<><Meta title="Not found" noindex /><NotFound /></>);
    }
    return (
      <div className="w-full py-32 text-center text-muted-foreground" data-testid="board-detail-error">
        <Meta title="Board of Advisors" noindex />
        <p className="mb-4">Something went wrong. Please try again.</p>
        <button
          onClick={() => q.refetch()}
          className="inline-flex h-10 items-center rounded-md border border-border px-5 text-sm hover:border-primary hover:text-primary transition-colors"
          data-testid="button-board-detail-retry"
        >
          Try again
        </button>
      </div>
    );
  }

  const person = s.canView && !q.isError ? q.data : undefined;
  if (!person) return (<><Meta title="Not found" noindex /><NotFound /></>);

  const isPrivate = !s.isPublic;
  const imageSrc = resolveImageUrl(person.imageUrl);
  const first = person.name.split(" ")[0];
  const metaDescription =
    stripHtml(person.shortDescription) ||
    `${person.name}${person.jobTitle ? ` — ${person.jobTitle}` : ""}, Board of Advisors, The Synozur Alliance.`;
  const linkedin = safeHref(person.linkedinUrl);
  const website = safeHref(person.website);
  const booking = safeHref(person.speakerBookingUrl);
  const mail = safeEmail(person.email);

  return (
    <div className="w-full">
      <Meta
        title={person.name}
        description={metaDescription}
        image={imageSrc}
        type="article"
        noindex={isPrivate}
      />
      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-20" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <Link
            href="/board"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
            data-testid="link-board-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Board of Advisors
          </Link>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-10 items-start">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="md:col-span-2"
            >
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-white/5 border border-white/10">
                {imageSrc ? (
                  <img src={imageSrc} alt={person.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
                    {person.name}
                  </div>
                )}
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="md:col-span-3"
            >
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                Board of Advisors
              </p>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-3" data-testid="text-board-name">
                {person.name}
              </h1>
              {person.jobTitle && (
                <p className="text-xl text-primary mb-6">{person.jobTitle}</p>
              )}
              {person.shortDescription && (
                <RichText
                  html={person.shortDescription}
                  className="text-xl text-zinc-300 leading-relaxed mb-8 [&_p]:mb-4 [&_strong]:text-white"
                  invert
                />
              )}
              <div className="flex flex-wrap gap-3">
                {linkedin && (
                  <a href={linkedin} target="_blank" rel="noopener noreferrer" className={btn} data-testid="link-board-linkedin">
                    <Linkedin className="h-4 w-4" /> LinkedIn
                  </a>
                )}
                {mail && (
                  <a href={mail} className={btn} data-testid="link-board-email">
                    <Mail className="h-4 w-4" /> Email
                  </a>
                )}
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer" className={btn} data-testid="link-board-website">
                    <Globe className="h-4 w-4" /> Website
                  </a>
                )}
                {booking && (
                  <a
                    href={booking}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    data-testid="link-board-booking"
                  >
                    <Mic2 className="h-4 w-4" /> Book {first}
                  </a>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </section>
      {isPrivate && <PrivateBoardBanner />}

      {person.longDescription && (
        <section className="py-20 bg-background">
          <div className="container mx-auto px-4 max-w-3xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">About {first}</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-8">Biography</h2>
            <RichText
              html={person.longDescription}
              className="prose-lg text-lg text-muted-foreground leading-relaxed [&_p]:mb-5"
            />
          </div>
        </section>
      )}

      <section className="py-20 bg-card border-t border-border">
        <div className="container mx-auto px-4 max-w-5xl flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-widest text-primary mb-2">Board of Advisors</p>
            <h2 className="text-2xl md:text-3xl font-bold">Meet the full board</h2>
          </div>
          <Link
            href="/board"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            data-testid="link-board-all"
          >
            All advisors
          </Link>
        </div>
      </section>
    </div>
  );
}
