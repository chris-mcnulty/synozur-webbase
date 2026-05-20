import { Meta } from "@/lib/meta";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, Clock, ExternalLink } from "lucide-react";
import { careersApi } from "@/lib/careers-api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export default function CareersEmbedJobs() {
  const { data, isLoading } = useQuery({
    queryKey: ["careers", "jobs"],
    queryFn: () => careersApi.listJobs(),
  });

  const jobs = (data?.items ?? []).filter((j) => j.status === "published");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      className="min-h-screen bg-[#0d0d14] text-white p-4"
    >
      <Meta title="Careers — open positions" noindex />
      {isLoading && (
        <div className="text-[#8b8ba8] text-sm py-8 text-center">Loading positions…</div>
      )}

      {!isLoading && jobs.length === 0 && (
        <div className="text-[#8b8ba8] text-sm py-8 text-center">
          No open positions at this time.
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-3 max-w-2xl mx-auto">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border border-[#2a2a3d] bg-[#13131f] p-5 hover:border-[#810FFB]/60 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base text-white leading-snug">{job.title}</h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-[#8b8ba8]">
                    {job.department && (
                      <span className="flex items-center gap-1">
                        <Briefcase size={11} /> {job.department}
                      </span>
                    )}
                    {job.location && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} /> {job.location}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {TYPE_LABEL[job.employmentType] ?? job.employmentType}
                    </span>
                    <span className="font-mono">{job.requisitionNumber}</span>
                  </div>
                  {job.description && (
                    <p className="mt-2 text-xs text-[#8b8ba8] line-clamp-2 leading-relaxed">
                      {job.description}
                    </p>
                  )}
                </div>
                <a
                  href={`${origin}${BASE_PATH}/careers/jobs/${job.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#810FFB]/15 text-[#b57dff] hover:bg-[#810FFB]/30 transition-colors whitespace-nowrap"
                >
                  View & Apply <ExternalLink size={11} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 text-center text-[10px] text-[#4a4a65]">
        <a
          href={`${origin}${BASE_PATH}/careers`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[#8b8ba8] transition-colors"
        >
          Powered by The Synozur Alliance
        </a>
      </div>
    </div>
  );
}
