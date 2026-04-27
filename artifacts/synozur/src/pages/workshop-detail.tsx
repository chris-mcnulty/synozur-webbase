import { useState } from "react";
import { Meta } from "@/lib/meta";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Monitor,
  Users,
  UserCheck,
  ListChecks,
} from "lucide-react";
import { workshopsApi, WorkshopsApiError, type WorkshopCTA as CTA } from "@/lib/api-workshops";
import { trackEvent } from "@/lib/traffic-tracker";
import NotFound from "@/pages/not-found";
import { BookingCard } from "@/components/BookingCard";

function isExternal(href: string) {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function CTAButton({
  cta,
  variant = "primary",
  workshopSlug,
}: {
  cta: CTA;
  variant?: "primary" | "secondary";
  workshopSlug?: string;
}) {
  const className =
    variant === "primary"
      ? "inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
      : "inline-flex h-12 items-center justify-center rounded-md border border-border bg-transparent px-8 text-base font-medium text-foreground hover:border-primary hover:text-primary transition-colors";
  const onClick = () => {
    void trackEvent("workshop-cta-click", {
      slug: workshopSlug ?? null,
      label: cta.label,
      href: cta.href,
      variant,
    });
  };
  if (isExternal(cta.href)) {
    return (
      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={onClick}
      >
        {cta.label}
        {variant === "primary" && <ArrowRight className="ml-2 h-4 w-4" />}
      </a>
    );
  }
  return (
    <Link href={cta.href} className={className} onClick={onClick}>
      {cta.label}
      {variant === "primary" && <ArrowRight className="ml-2 h-4 w-4" />}
    </Link>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <>
      {eyebrow && (
        <p className="text-sm uppercase tracking-widest text-primary mb-3">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl md:text-4xl font-bold mb-8">{title}</h2>
    </>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((b, i) => (
        <li key={i} className="flex gap-3 text-base leading-relaxed">
          <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <span className="text-muted-foreground">{b}</span>
        </li>
      ))}
    </ul>
  );
}

export default function WorkshopDetail() {
  const [, params] = useRoute("/workshops/:slug");
  const slug = params?.slug;

  const detailQ = useQuery({
    queryKey: ["public-workshop", slug],
    queryFn: () => workshopsApi.getPublic(slug!),
    enabled: !!slug,
    retry: false,
  });
  const listQ = useQuery({
    queryKey: ["public-workshops"],
    queryFn: () => workshopsApi.listPublic(),
  });

  if (detailQ.isLoading) {
    return (
      <div className="w-full py-24 text-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (detailQ.isError) {
    const is404 =
      detailQ.error instanceof WorkshopsApiError && detailQ.error.status === 404;
    if (is404) return <NotFound />;
    return (
      <div className="w-full py-24 text-center text-destructive">
        Failed to load workshop. Please try again.
      </div>
    );
  }

  const w = detailQ.data;
  if (!w) {
    return <NotFound />;
  }

  const more = (listQ.data?.items ?? [])
    .filter((x) => x.slug !== w.slug)
    .slice(0, 3);

  return (
    <div className="w-full">
      <Meta title={w.seo.title || w.title} description={w.seo.description} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-15" />
        <div className="container relative z-10 mx-auto px-4 max-w-6xl">
          <Link
            href="/workshops"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All workshops
          </Link>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">
            <div className="lg:col-span-3">
              <span className="inline-block py-1 px-3 rounded-full bg-primary/20 border border-primary/30 text-white text-xs font-medium backdrop-blur-sm mb-5">
                {w.category}
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-6">
                {w.heroHeadline}
              </h1>
              <p className="text-lg md:text-xl text-zinc-300 leading-relaxed mb-8">
                {w.heroSubhead}
              </p>
              {w.heroTrustBullets.length > 0 && (
                <ul className="space-y-2.5 mb-10">
                  {w.heroTrustBullets.map((b, i) => (
                    <li key={i} className="flex gap-3 text-zinc-200">
                      <Check className="h-5 w-5 text-primary shrink-0 mt-1" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-4">
                <CTAButton cta={w.primaryCTA} variant="primary" workshopSlug={slug} />
                {w.secondaryCTA && w.secondaryCTA.href && (
                  <CTAButton cta={w.secondaryCTA} variant="secondary" workshopSlug={slug} />
                )}
              </div>
            </div>
            <div className="lg:col-span-2">
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6 }}
                className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl aspect-[4/3] bg-card"
              >
                <img
                  src={w.heroImage}
                  alt={w.title}
                  className="w-full h-full object-cover"
                />
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Key facts strip */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-px bg-border rounded-xl overflow-hidden border border-border">
            <FactCell icon={<Monitor className="h-5 w-5" />} label="Delivery">
              {w.deliveryFormat}
            </FactCell>
            <FactCell icon={<Clock className="h-5 w-5" />} label="Duration">
              {w.duration}
            </FactCell>
            <FactCell icon={<Users className="h-5 w-5" />} label="Who it's for">
              <ul className="space-y-1">
                {w.whoItsFor.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </FactCell>
            <FactCell
              icon={<UserCheck className="h-5 w-5" />}
              label="Ideal participants"
            >
              <ul className="space-y-1">
                {w.idealParticipants.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </FactCell>
            <FactCell
              icon={<ListChecks className="h-5 w-5" />}
              label="Prerequisites"
            >
              <ul className="space-y-1">
                {w.prerequisites.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </FactCell>
          </div>
        </div>
      </section>

      {/* Pain */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <SectionHeader eyebrow={w.pain.header} title={w.pain.lead} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {w.pain.tiles.map((t, i) => (
              <div
                key={i}
                className="rounded-xl border border-border/60 bg-card p-6 text-base leading-relaxed text-muted-foreground"
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scope */}
      <section className="py-16 bg-card border-y border-border">
        <div className="container mx-auto px-4 max-w-5xl">
          <SectionHeader eyebrow={w.scope.header} title={w.scope.summary} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div>
              <BulletList items={w.scope.bullets} />
            </div>
            <div>
              <BulletList items={w.scope.included} />
            </div>
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-4xl">
          <SectionHeader title={w.process.header} />
          <ol className="space-y-5">
            {w.process.steps.map((s, i) => (
              <li
                key={i}
                className="flex gap-5 rounded-xl border border-border/60 bg-card p-5"
              >
                <span className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
                  {i + 1}
                </span>
                <span className="text-base leading-relaxed text-muted-foreground pt-1.5">
                  {s}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Deliverables */}
      <section className="py-16 bg-card border-y border-border">
        <div className="container mx-auto px-4 max-w-6xl">
          <SectionHeader title={w.deliverables.header} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <DeliverableGroup items={w.deliverables.core} />
            <DeliverableGroup items={w.deliverables.executive} />
            <DeliverableGroup items={w.deliverables.enablement} />
            <DeliverableGroup items={w.deliverables.addOns} />
          </div>
        </div>
      </section>

      {/* Price + Timeline */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="rounded-2xl border border-primary/30 bg-card overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
              <div className="bg-card p-8">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                  {w.price.label}
                </p>
                <p className="text-3xl md:text-4xl font-bold text-primary leading-tight">
                  {w.price.display}
                </p>
              </div>
              <div className="bg-card p-8">
                <p className="text-lg font-semibold leading-snug">
                  {w.price.timeline}
                </p>
              </div>
              <div className="bg-card p-8">
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {w.price.whatIsIncluded.map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Diagnostic (optional) */}
      {w.diagnostic && (
        <section className="py-16 bg-card border-y border-border">
          <div className="container mx-auto px-4 max-w-5xl">
            <SectionHeader
              eyebrow={w.diagnostic.header}
              title={w.diagnostic.summary}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {w.diagnostic.whatWeAssess.length > 0 && (
                <div>
                  <BulletList items={w.diagnostic.whatWeAssess} />
                </div>
              )}
              {w.diagnostic.questionnairePreview.length > 0 && (
                <div>
                  <ul className="space-y-3 text-base leading-relaxed text-muted-foreground">
                    {w.diagnostic.questionnairePreview.map((q, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-border/60 bg-background p-4"
                      >
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Competitive Intel (optional) */}
      {w.competitiveIntel && (
        <section className="py-16 bg-background">
          <div className="container mx-auto px-4 max-w-5xl">
            <SectionHeader
              eyebrow={w.competitiveIntel.header}
              title={w.competitiveIntel.summary}
            />
            {w.competitiveIntel.outputs.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-card p-8">
                <BulletList items={w.competitiveIntel.outputs} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tooling note (optional) */}
      {w.toolingNote && (
        <section className="py-12 bg-card border-y border-border">
          <div className="container mx-auto px-4 max-w-3xl">
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed text-center italic">
              {w.toolingNote}
            </p>
          </div>
        </section>
      )}

      {/* Outcomes */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <SectionHeader title={w.outcomes.header} />
          <div className="max-w-4xl">
            <BulletList items={w.outcomes.bullets} />
          </div>

          {(w.beforeExample || w.afterExample) && (
            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
              {w.beforeExample && (
                <div className="rounded-xl border border-border/60 bg-card p-8">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                    Before
                  </p>
                  <p className="text-lg leading-relaxed text-muted-foreground">
                    {w.beforeExample}
                  </p>
                </div>
              )}
              {w.afterExample && (
                <div className="rounded-xl border border-primary/40 bg-card p-8">
                  <p className="text-xs uppercase tracking-widest text-primary mb-3">
                    After
                  </p>
                  <p className="text-lg leading-relaxed text-foreground">
                    {w.afterExample}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Sample Deliverables */}
      {w.sampleDeliverables.header && (
        <section className="py-16 bg-background">
          <div className="container mx-auto px-4 max-w-5xl text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-6">
              {w.sampleDeliverables.header}
            </h2>
            {w.sampleDeliverables.thumbs.length > 0 && (
              <SampleThumbGrid thumbs={w.sampleDeliverables.thumbs} />
            )}
            {w.sampleDeliverables.link ? (
              <a
                href={w.sampleDeliverables.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-primary hover:underline"
              >
                View sample deliverables{" "}
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            ) : (
              <a
                href="mailto:contactus@synozur.com"
                className="inline-flex items-center text-primary hover:underline"
              >
                Request sample deliverables{" "}
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            )}
          </div>
        </section>
      )}

      {/* FAQ */}
      {w.faq.items.length > 0 && (
        <section className="py-16 bg-card border-y border-border">
          <div className="container mx-auto px-4 max-w-3xl">
            <SectionHeader title={w.faq.header} />
            <div className="space-y-5">
              {w.faq.items.map((item, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/60 bg-background p-6"
                >
                  <h3 className="text-base font-semibold mb-2 text-foreground">
                    {item.q}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* More workshops */}
      {more.length > 0 && (
        <section className="py-20 bg-background border-t border-border">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 className="text-2xl md:text-3xl font-bold mb-10">
              More workshops
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {more.map((r) => (
                <Link
                  key={r.slug}
                  href={`/workshops/${r.slug}`}
                  className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors block"
                >
                  <div className="aspect-[16/9] overflow-hidden">
                    <img
                      src={r.heroImage}
                      alt={r.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-6">
                    <span className="text-xs uppercase tracking-widest text-primary">
                      {r.category}
                    </span>
                    <h3 className="text-lg font-bold mt-2 mb-3 group-hover:text-primary transition-colors leading-snug">
                      {r.title}
                    </h3>
                    <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary">
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {w.booking && (
        <section className="py-16 border-t border-border">
          <div className="container mx-auto px-4 max-w-2xl">
            <BookingCard booking={w.booking} />
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="relative overflow-hidden bg-card border-t border-border py-20">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton cta={w.primaryCTA} variant="primary" workshopSlug={slug} />
            {w.secondaryCTA && w.secondaryCTA.href && (
              <CTAButton cta={w.secondaryCTA} variant="secondary" workshopSlug={slug} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SampleThumbGrid({ thumbs }: { thumbs: string[] }) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const visible = thumbs.filter((t) => !broken.has(t));
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      {visible.map((t, i) => (
        <div
          key={t}
          className="rounded-xl overflow-hidden border border-border/60 bg-card aspect-[4/3]"
        >
          <img
            src={t}
            alt={`Sample deliverable ${i + 1}`}
            className="w-full h-full object-cover"
            onError={() =>
              setBroken((prev) => {
                const next = new Set(prev);
                next.add(t);
                return next;
              })
            }
          />
        </div>
      ))}
    </div>
  );
}

function FactCell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card p-6 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function DeliverableGroup({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background p-6">
      <ul className="space-y-2.5">
        {items.map((b, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
            <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
