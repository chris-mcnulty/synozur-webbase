import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Briefcase, MapPin, Clock, ExternalLink } from "lucide-react";
import { careersApi } from "@/lib/careers-api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export default function CareersEmbedJob() {
  const [, params] = useRoute<{ slug: string }>("/careers/embed/job/:slug");
  const slug = params?.slug ?? "";

  const { data: job, isLoading, error } = useQuery({
    queryKey: ["careers", "job", slug],
    queryFn: () => careersApi.getJob(slug),
    enabled: !!slug,
    retry: false,
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (isLoading) {
    return (
      <div style={{ fontFamily: "system-ui, -apple-system, sans-serif" }} className="min-h-screen bg-[#0d0d14] text-white p-6 flex items-center justify-center">
        <div className="text-[#8b8ba8] text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div style={{ fontFamily: "system-ui, -apple-system, sans-serif" }} className="min-h-screen bg-[#0d0d14] text-white p-6 flex items-center justify-center">
        <div className="text-[#8b8ba8] text-sm">Position not found or no longer available.</div>
      </div>
    );
  }

  return (
    <div
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      className="min-h-screen bg-[#0d0d14] text-white"
    >
      <div className="max-w-2xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-[#8b8ba8] mb-3 font-mono">{job.requisitionNumber}</div>
          <h1 className="text-2xl font-bold text-white leading-tight">{job.title}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-[#8b8ba8]">
            {job.department && (
              <span className="flex items-center gap-1">
                <Briefcase size={12} /> {job.department}
              </span>
            )}
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin size={12} /> {job.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={12} /> {TYPE_LABEL[job.employmentType] ?? job.employmentType}
            </span>
            {job.salaryRange && <span>{job.salaryRange}</span>}
          </div>
        </div>

        <div className="h-px bg-[#2a2a3d] mb-6" />

        {/* Description */}
        <div className="space-y-3 text-sm text-[#c4c4d4] leading-relaxed mb-6">
          {job.description && <p>{job.description}</p>}
          {job.descriptionParagraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {/* Requirements */}
        {job.requirementsParagraphs.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-[#810FFB] uppercase tracking-wider mb-3">
              What you bring
            </h2>
            <ul className="space-y-2">
              {job.requirementsParagraphs.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-[#c4c4d4]">
                  <span className="text-[#810FFB] shrink-0 mt-0.5">·</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        <a
          href={`${origin}${BASE_PATH}/careers/jobs/${job.slug}/apply`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#810FFB] text-white text-sm font-semibold hover:bg-[#6d0de0] transition-colors"
        >
          Apply for this role <ExternalLink size={14} />
        </a>

        <div className="mt-8 pt-6 border-t border-[#2a2a3d] text-center text-[10px] text-[#4a4a65]">
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
    </div>
  );
}
