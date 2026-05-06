import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Briefcase, MapPin, Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { careersApi } from "@/lib/careers-api";

const TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

const VALUE_PROPS = [
  {
    title: "High-Impact Work",
    body: "Work on strategic initiatives for Fortune 500 clients that reshape industries and drive real value.",
  },
  {
    title: "Purpose Driven",
    body: "We believe in empathetic approaches, ensuring unique journeys are supported with the right strategies.",
  },
  {
    title: "Global Reach",
    body: "Join a diverse team of leaders delivering outcomes across the globe, with flexible remote options.",
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

      {/* ── Hero ── */}
      <section
        className="relative flex flex-col items-center justify-center text-center px-4 py-32 md:py-48 overflow-hidden"
        data-testid="careers-hero"
      >
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url(/careers-hero.jpg)" }}
          aria-hidden="true"
        />
        {/* Dark overlay so text remains readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-[#0a0012]/90" aria-hidden="true" />

        {/* Content */}
        <div className="relative z-10 max-w-3xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-widest text-fuchsia-400 mb-3">
            Careers at Synozur
          </p>
          <h1
            className="text-5xl md:text-7xl font-bold tracking-tight text-white"
            data-testid="careers-heading"
          >
            Find Your{" "}
            <span className="bg-gradient-to-r from-fuchsia-400 via-purple-300 to-cyan-300 bg-clip-text text-transparent">
              North Star
            </span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/80 max-w-2xl mx-auto leading-relaxed">
            Join the transformation team. We guide organizations through change
            rooted in people, powered by technology, and driven by purpose.
          </p>

          {/* Search bar */}
          <div className="mt-10 flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
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
                className="w-full pl-9 pr-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent"
                data-testid="input-job-search"
              />
            </div>
            <Button size="lg" className="px-8 shrink-0" data-testid="button-search-jobs">
              Search Jobs
            </Button>
          </div>
        </div>
      </section>

      {/* ── Value props ── */}
      <section className="px-4 py-16 border-b border-border" data-testid="careers-value-props">
        <div className="mx-auto max-w-5xl grid md:grid-cols-3 gap-8 text-center">
          {VALUE_PROPS.map(({ title, body }) => (
            <div key={title} className="space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/15 mx-auto">
                <span className="block h-2 w-2 rounded-full bg-fuchsia-400" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
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
            <ul className="space-y-3" data-testid="careers-job-list">
              {filtered.map((j) => (
                <li key={j.id}>
                  <Link href={`/careers/jobs/${j.slug}`}>
                    {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href. */}
                    <a
                      className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-border bg-card p-5 hover-elevate group"
                      data-testid={`careers-job-${j.slug}`}
                    >
                      <div>
                        <div className="text-lg font-medium text-foreground group-hover:text-fuchsia-300 transition-colors">
                          {j.title}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          {j.department && (
                            <span className="flex items-center gap-1">
                              <Briefcase size={14} /> {j.department}
                            </span>
                          )}
                          {j.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={14} /> {j.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock size={14} />{" "}
                            {TYPE_LABEL[j.employmentType] ?? j.employmentType}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-fuchsia-300 group-hover:translate-x-1 transition-transform shrink-0">
                        View role →
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
