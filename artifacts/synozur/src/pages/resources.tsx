import { Link } from "wouter";
import { Meta } from "@/lib/meta";
import {
  Newspaper, CalendarDays, Mic, MonitorPlay, Wrench,
  Boxes, FileText, Library, ArrowRight,
} from "lucide-react";

const HUBS = [
  {
    icon: Newspaper,
    label: "Insights Blog",
    desc: "Our blog — practitioner articles, analysis, and white papers on AI-first operating models, go-to-market strategy, and transformation leadership.",
    href: "/insights",
    cta: "Read the blog",
  },
  {
    icon: CalendarDays,
    label: "Events",
    desc: "Live and virtual events where Synozur leaders and partners share what's working in AI-first organizations. Browse upcoming and past sessions.",
    href: "/events",
    cta: "Browse events",
  },
  {
    icon: Mic,
    label: "Polaris Podcast",
    desc: "Candid conversations with founders, operators, and advisors navigating the AI transition — wherever you listen to podcasts.",
    href: "/polaris",
    cta: "Listen now",
  },
  {
    icon: MonitorPlay,
    label: "Webinars",
    desc: "On-demand deep-dives hosted by Synozur advisors. Filter by topic and watch at your own pace.",
    href: "/webinars",
    cta: "Watch on demand",
  },
  {
    icon: Wrench,
    label: "Workshops",
    desc: "Structured half-day and full-day programs that move your leadership team from awareness to action on specific AI-first challenges.",
    href: "/workshops",
    cta: "Explore workshops",
  },
  {
    icon: Boxes,
    label: "Models & Frameworks",
    desc: "The diagnostic tools and decision frameworks we use inside client engagements — published for you to apply in your own organization.",
    href: "/models",
    cta: "Explore models",
  },
  {
    icon: FileText,
    label: "Case Studies",
    desc: "Real outcomes from real clients. Concrete before-and-after evidence across industries, company sizes, and transformation types.",
    href: "/case-studies",
    cta: "Read case studies",
  },
  {
    icon: Library,
    label: "Browse the Library",
    desc: "Everything in one place — filter by content type, topic, or keyword to find exactly what you need.",
    href: "/library",
    cta: "Open the library",
  },
];

export default function ResourcesHub() {
  return (
    <>
      <Meta
        title="Resources"
        description="Insights blog, events, podcast, webinars, workshops, frameworks, and case studies from Synozur — everything you need to lead an AI-first organization."
        rawTitle
      />

      {/* Hero */}
      <section className="bg-[#0B0B1A] pt-28 pb-16 px-4">
        <div className="container mx-auto max-w-3xl text-center">
          <p className="text-sm uppercase tracking-widest text-primary font-semibold mb-4">
            Resources
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-5">
            Everything you need to lead
            <br className="hidden md:block" />{" "}
            an{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#810FFB] to-[#3aa0ff]">
              AI-first organization
            </span>
          </h1>
          <p className="text-lg text-white/60 max-w-2xl mx-auto">
            Articles, frameworks, case studies, events, and more — curated by Synozur advisors
            and updated continuously.
          </p>
        </div>
      </section>

      {/* Hub grid */}
      <section className="bg-background py-16 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {HUBS.map(({ icon: Icon, label, desc, href, cta }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-6 transition-all duration-200 hover:border-primary/40 hover:shadow-[0_0_24px_rgba(129,15,251,0.08)]"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h2 className="font-bold text-foreground text-base mb-2">{label}</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary group-hover:gap-2.5 transition-all">
                  {cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Book CTA band */}
      <section className="bg-[#0B0B1A] py-16 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-4">
            Ready to go deeper?
          </h2>
          <p className="text-white/60 mb-8">
            Our resources give you the context. The Sprint gives you the plan.
          </p>
          <Link
            href="/book"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-semibold text-white shadow-[0_0_20px_rgba(129,15,251,0.4)] hover:bg-primary/90 transition-colors"
          >
            Book the AI &amp; North Star Sprint
          </Link>
        </div>
      </section>
    </>
  );
}
