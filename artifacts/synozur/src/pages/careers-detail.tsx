import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Briefcase, MapPin, Clock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { careersApi } from "@/lib/careers-api";

const TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export default function CareersDetailPage() {
  const [, params] = useRoute<{ slug: string }>("/careers/jobs/:slug");
  const slug = params?.slug ?? "";
  const { data: job, isLoading, error } = useQuery({
    queryKey: ["careers", "job", slug],
    queryFn: () => careersApi.getJob(slug),
    enabled: !!slug,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-16 max-w-3xl mx-auto" data-testid="career-loading">
        Loading…
      </div>
    );
  }
  if (error || !job) {
    return (
      <div className="px-4 py-16 max-w-3xl mx-auto" data-testid="career-not-found">
        <h1 className="text-2xl font-semibold">Position not found</h1>
        <p className="text-muted-foreground mt-2">
          This role is no longer open. <Link href="/careers"><a className="text-fuchsia-300 underline">View open positions</a></Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-12 max-w-3xl mx-auto">
      <Meta title={`${job.title} — Careers`} description={job.description.slice(0, 160) || job.title} />
      <Link href="/careers">
        <a className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={14} /> All positions
        </a>
      </Link>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight" data-testid="career-title">
        {job.title}
      </h1>
      <div className="mt-3 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-mono">{job.requisitionNumber}</span>
        {job.department && <span className="flex items-center gap-1"><Briefcase size={14} /> {job.department}</span>}
        {job.location && <span className="flex items-center gap-1"><MapPin size={14} /> {job.location}</span>}
        <span className="flex items-center gap-1"><Clock size={14} /> {TYPE_LABEL[job.employmentType] ?? job.employmentType}</span>
        {job.salaryRange && <span>{job.salaryRange}</span>}
      </div>

      <div className="mt-8 prose prose-invert max-w-none">
        {job.description && <p>{job.description}</p>}
        {job.descriptionParagraphs.map((p, i) => (
          <p key={`d${i}`}>{p}</p>
        ))}
        {job.requirementsParagraphs.length > 0 && (
          <>
            <h2>What you bring</h2>
            <ul>
              {job.requirementsParagraphs.map((r, i) => (
                <li key={`r${i}`}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-10">
        <Link href={`/careers/jobs/${job.slug}/apply`}>
          <a>
            <Button size="lg" data-testid="button-apply">
              Apply for this role
            </Button>
          </a>
        </Link>
      </div>
    </div>
  );
}
