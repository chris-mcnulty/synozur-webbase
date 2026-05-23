import { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type PageHeroProps = {
  /** Small caps eyebrow above the title. */
  eyebrow?: ReactNode;
  /** Main page title. Accept ReactNode so callers can embed `<span className="nebula-text">…</span>`. */
  title: ReactNode;
  /** Lead paragraph under the title. */
  subtitle?: ReactNode;
  /** Optional CTA / supplementary content rendered below the subtitle. */
  children?: ReactNode;
  /** Animate the heading on mount. Defaults to true. */
  animate?: boolean;
  /** Additional class on the outer <section>. */
  className?: string;
  /** Hook for e2e tests. */
  "data-testid"?: string;
};

/**
 * Standardised page hero used across the marketing site (About, Team,
 * Clients, Partners, Careers, Solutions overview, individual solutions,
 * Polaris, Events, Insights, Applications, Resources etc).
 *
 * Pattern:
 *  - Full-bleed dark indigo background (#0B0B1A) with the soft nebula
 *    gradient overlay.
 *  - Left-aligned content (matches the dominant existing pattern).
 *  - `max-w-4xl` content column inside the standard container.
 *  - Eyebrow / H1 / subtitle hierarchy with the project's standard
 *    sizing (text-sm uppercase eyebrow, text-5xl→7xl headline,
 *    text-xl→2xl lead paragraph).
 *
 * Heroes that need custom layouts (the home page two-column hero, the
 * Polaris show-art collage, etc) continue to render their own markup —
 * this component is for the long tail of "title + lead" hero blocks.
 */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  children,
  animate = true,
  className,
  ...rest
}: PageHeroProps) {
  const MotionTag = animate ? motion.div : "div";
  const motionProps = animate
    ? {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6 },
      }
    : {};

  return (
    <section
      className={cn(
        "relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32",
        className,
      )}
      data-testid={rest["data-testid"] ?? "page-hero"}
    >
      <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
      <div className="container relative z-10 mx-auto px-4 max-w-4xl">
        <MotionTag {...(motionProps as object)}>
          {eyebrow ? (
            <p className="text-sm uppercase tracking-widest text-primary mb-4">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
              {subtitle}
            </p>
          ) : null}
          {children ? <div className="mt-8">{children}</div> : null}
        </MotionTag>
      </div>
    </section>
  );
}
