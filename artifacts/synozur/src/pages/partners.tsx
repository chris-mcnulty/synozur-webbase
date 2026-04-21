import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

const MicrosoftSquares = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="0" y="0" width="10" height="10" fill="#F25022" />
    <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
    <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
    <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
  </svg>
);

const fade = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, delay: i * 0.08 },
});

type AllianceDisplay = {
  name: string;
  src: string;
  href: string;
  filter: boolean;
  description?: string;
};

// Default alliance logos used when the DB-backed
// `partner_descriptions` table is empty. Editors can override these via
// the admin without a deploy.
const DEFAULT_ALLIANCES: AllianceDisplay[] = [
  {
    name: "Protiviti",
    src: "/images/logos/protiviti.svg",
    href: "https://www.protiviti.com",
    filter: false,
  },
  {
    name: "ps hummingbird",
    src: "/images/logos/ps-hummingbird.png",
    href: "https://www.pshummingbird.com",
    filter: true,
  },
  {
    name: "Creospark",
    src: "/images/logos/creospark.png",
    href: "https://creospark.com",
    filter: false,
  },
];

// Logos that look correct on a light background ship as-is; those that
// were white-on-dark get inverted via a CSS filter. We infer this by
// filename suffix since the CMS column cannot store arbitrary CSS.
function inferLogoFilter(logo: string | null | undefined): boolean {
  if (!logo) return false;
  return /ps-hummingbird/i.test(logo);
}

export default function Partners() {
  const partnersQ = useQuery({
    queryKey: ["partners"],
    queryFn: () => api.listPartners("alliance"),
  });

  const alliances: AllianceDisplay[] = useMemo(() => {
    const items = partnersQ.data?.items ?? [];
    if (items.length === 0) return DEFAULT_ALLIANCES;
    return items.map((p) => ({
      name: p.name,
      src: p.logo ?? "",
      href: p.websiteUrl ?? "#",
      filter: inferLogoFilter(p.logo),
      description: p.description,
    }));
  }, [partnersQ.data]);
  return (
    <div className="w-full">
      <Meta
        title="Partners"
        description="Synozur adopts a strategic and transparent approach to partnerships by maintaining regular communication and leveraging continuous improvement practices."
      />

      {/* Hero */}
      <section className="relative overflow-hidden py-24 md:py-32" style={{ background: "linear-gradient(135deg, #6B1FA8 0%, #C026D3 100%)" }}>
        <div className="container relative z-10 mx-auto px-6 max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
            Our Partners
          </h1>
          <p className="text-lg md:text-xl text-white/90 leading-relaxed max-w-2xl">
            Synozur adopts a strategic and transparent approach to partnerships
            by maintaining regular communication and leveraging continuous
            improvement practices. By aligning strategies with evolving market
            conditions and fostering a culture of proactive research and
            learning, Synozur ensures long-term success in collaborations with
            industry leaders like Microsoft.
          </p>
        </div>
      </section>

      {/* Microsoft */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-5xl">
          <motion.h2
            {...fade(0)}
            className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-14"
          >
            Microsoft
          </motion.h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-10 md:gap-20">
            {/* Microsoft Partner badge */}
            <motion.a
              {...fade(1)}
              href="https://partner.microsoft.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 group"
              aria-label="Microsoft Partner"
            >
              <MicrosoftSquares size={38} />
              <span className="text-2xl font-semibold text-gray-600 group-hover:text-gray-900 transition-colors tracking-tight">
                Microsoft Partner
              </span>
            </motion.a>

            {/* Microsoft Preferred Content AI badge */}
            <motion.a
              {...fade(2)}
              href="https://partner.microsoft.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 group"
              aria-label="Microsoft Preferred Content AI"
            >
              <MicrosoftSquares size={28} />
              <div className="flex flex-col leading-tight">
                <span className="text-xl font-bold text-gray-900 group-hover:text-gray-700 transition-colors">
                  Preferred
                </span>
                <span className="text-base text-gray-700 border-b-2 border-gray-700 pb-0.5">
                  Content AI
                </span>
              </div>
            </motion.a>
          </div>
        </div>
      </section>

      {/* Alliance Implementation Partners */}
      <section className="py-20 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-6 max-w-5xl">
          <motion.h2
            {...fade(0)}
            className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-14"
          >
            Alliance Implementation Partners
          </motion.h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-12 md:gap-16 flex-wrap">
            {alliances.map((p, i) => (
              <motion.a
                key={p.name}
                {...fade(i + 1)}
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center opacity-85 hover:opacity-100 transition-opacity"
                aria-label={p.name}
              >
                <img
                  src={p.src}
                  alt={p.name}
                  className="h-14 max-w-[180px] object-contain"
                  style={p.filter ? { filter: "invert(1) brightness(0)" } : undefined}
                />
              </motion.a>
            ))}
          </div>
        </div>
      </section>

      {/* Why we partner the way we do */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-5xl">
          <motion.h2 {...fade(0)} className="text-3xl md:text-4xl font-bold text-gray-900 mb-12 text-center">
            How we work with partners
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: "Microsoft Ecosystem",
                body:
                  "We help organizations get the most from the Microsoft ecosystem — and help Microsoft partners build durable businesses on top of it. Strategy, offers, GTM, and field enablement.",
              },
              {
                title: "Ecosystem Alliances",
                body:
                  "We work alongside hyperscalers, ISVs, and systems integrators where the engagement calls for it — composing the right team rather than defending a single stack.",
              },
              {
                title: "Boutique Specialists",
                body:
                  "When a problem demands deep specialization — design, AI research, change management — we partner with the small firms doing the most interesting work in those areas.",
              },
            ].map((card, i) => (
              <motion.div
                key={card.title}
                {...fade(i + 1)}
                className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-violet-200 hover:shadow-sm transition-all"
              >
                <h3 className="text-xl font-bold text-gray-900 mb-3">{card.title}</h3>
                <p className="text-gray-600 leading-relaxed">{card.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden py-24 bg-card border-t border-border">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Interested in partnering?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            We are deliberate about who we work with. If our practices line up
            with your roadmap, we would like to hear from you.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Reach the partner team <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
