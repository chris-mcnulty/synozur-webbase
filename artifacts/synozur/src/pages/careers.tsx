import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Briefcase,
  MapPin,
  Clock,
  Search,
  Compass,
  HeartHandshake,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { careersApi } from "@/lib/careers-api";
import { PageHero } from "@/components/layout/page-hero";

const TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

const VALUE_PROPS: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: "High-Impact Work",
    body: "Work on strategic initiatives for Fortune 500 clients that reshape industries and drive real value.",
    icon: Compass,
  },
  {
    title: "Purpose Driven",
    body: "We believe in empathetic approaches, ensuring unique journeys are supported with the right strategies.",
    icon: HeartHandshake,
  },
  {
    title: "Global Reach",
    body: "Join a diverse team of leaders delivering outcomes across the globe, with flexible remote options.",
    icon: Globe,
  },
];

export default function CareersPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["careers", "jobs"],
    queryFn: () => careersApi.listJobs(),
  });

  const jobs = data?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        (j.department ?? "").toLowerCase().includes(q) ||
        (j.location ?? "").toLowerCase().includes(q),
    );
  }, [jobs, search]);

  return (
    <div className="min-h-screen">
      <Meta
        title="Careers at Synozur"
        description="Join the transformation team. We guide organizations through change rooted in people, powered by technology, and driven by purpose."
      />

      <PageHero
        eyebrow="Careers at Synozur"
        title={
          <>
            Find Your <span className="nebula-text">North Star</span>
          </>
        }
        subtitle="Join the transformation team. We guide organizations through change
            rooted in people, powered by technology, and driven by purpose."
        data-testid="careers-hero"
      >
        <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
            />
            <input
              type="search"
              placeholder="Search for your next role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              data-testid="input-job-search"
            />
          </div>
          <Button size="lg" className="px-8 shrink-0" data-testid="button-search-jobs">
            Search Jobs
          </Button>
        </div>
      </PageHero>

      {/* ── Value props ── */}
      <section className="px-4 py-16 border-b border-border" data-testid="careers-value-props">
        <div className="mx-auto max-w-5xl grid md:grid-cols-3 gap-8">
          {VALUE_PROPS.map(({ title, body, icon: Icon }) => (
            <div key={title} className="space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-base text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Job listings ── */}
      <section className="px-4 py-16 pb-24">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h2 className="text-2xl font-semibold">
              {search.trim()
                ? `Results for "${search}"`
                : "Open positions"}
              {!isLoading && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  ({filtered.length})
                </span>
              )}
            </h2>
            <Button
              variant="outline"
              onClick={() => navigate("/careers/general-application")}
              data-testid="button-general-application"
            >
              Join talent network
            </Button>
          </div>

          {isLoading ? (
            <div className="text-muted-foreground" data-testid="careers-loading">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground"
              data-testid="careers-empty"
            >
              {search.trim()
                ? `No roles match "${search}" — try a different keyword or browse all.`
                : "No open positions right now — but our talent network is always open."}
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="careers-job-list">
              {filtered.map((j) => (
                <li key={j.id}>
                  <Link href={`/careers/jobs/${j.slug}`}>
                    {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href. */}
                    <a
                      className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-6 py-5 transition-all duration-150 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 hover:shadow-[0_0_0_1px_rgba(168,85,247,0.2)]"
                      data-testid={`careers-job-${j.slug}`}
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="text-base font-semibold text-foreground group-hover:text-fuchsia-300 transition-colors leading-snug">
                          {j.title}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {j.department && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                              <Briefcase size={11} /> {j.department}
                            </span>
                          )}
                          {j.location && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                              <MapPin size={11} /> {j.location}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                            <Clock size={11} /> {TYPE_LABEL[j.employmentType] ?? j.employmentType}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-fuchsia-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-150 text-lg">
                        →
                      </div>
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
