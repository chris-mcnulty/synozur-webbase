import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Briefcase, MapPin, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { careersApi } from "@/lib/careers-api";

const TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export default function CareersPage() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["careers", "jobs"],
    queryFn: () => careersApi.listJobs(),
  });

  const jobs = data?.items ?? [];

  return (
    <div className="min-h-screen">
      <Meta
        title="Careers"
        description="Open roles and our talent network at The Synozur Alliance."
      />
      <section className="px-4 py-16 md:py-24">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-400 via-purple-400 to-cyan-300 bg-clip-text text-transparent" data-testid="careers-heading">
            Build with us.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            We're hiring people who care about craft and outcomes. Browse open
            roles, or join our talent network to hear about future openings.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button
              size="lg"
              data-testid="button-general-application"
              onClick={() => navigate("/careers/general-application")}
            >
              Join talent network
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 pb-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold mb-6">Open positions</h2>
          {isLoading ? (
            <div className="text-muted-foreground" data-testid="careers-loading">Loading…</div>
          ) : jobs.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground" data-testid="careers-empty">
              No open positions right now — but our talent network is always open.
            </div>
          ) : (
            <ul className="space-y-3" data-testid="careers-job-list">
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/careers/jobs/${j.slug}`}>
                    <a
                      className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-border bg-card p-5 hover-elevate"
                      data-testid={`careers-job-${j.slug}`}
                    >
                      <div>
                        <div className="text-lg font-medium text-foreground">{j.title}</div>
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
                            <Clock size={14} /> {TYPE_LABEL[j.employmentType] ?? j.employmentType}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-fuchsia-300">View role →</div>
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
