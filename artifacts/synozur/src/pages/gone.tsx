import { useEffect } from "react";
import { Link } from "wouter";
import { Archive, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { api } from "@/lib/api";
import { workshopsApi } from "@/lib/api-workshops";

/**
 * Friendly "this content is no longer available" page (#162 / L13).
 *
 * Rendered by detail pages when the API returns HTTP 410 Gone — a row
 * that was once published but has since been archived or unpublished.
 * Distinct from <NotFound /> because the URL was once valid: we tell
 * the visitor the piece has been retired and steer them toward the
 * latest in that section instead of suggesting they mistyped.
 *
 * The HTTP status code is set on the SPA server (artifacts/synozur/server.mjs)
 * — this component only owns the visible UX.
 */

/**
 * Kinds correspond 1:1 to detail-page sections that can return 410.
 * Each kind drives:
 *  - the section index link (back href + label)
 *  - the noun shown in copy ("this insight", "this case study"…)
 *  - the source for the "latest 3" rail beneath the apology
 */
export type GoneKind =
  | "insight"
  | "case-study"
  | "white-paper"
  | "application"
  | "model"
  | "polaris-episode"
  | "workshop"
  | "service"
  | "solution";

interface KindMeta {
  noun: string;
  section: string;
  sectionLabel: string;
  itemHrefPrefix: string;
}

const KIND_META: Record<GoneKind, KindMeta> = {
  "insight": {
    noun: "post",
    section: "/insights",
    sectionLabel: "The Feed",
    itemHrefPrefix: "/insights",
  },
  "case-study": {
    noun: "case study",
    section: "/case-studies",
    sectionLabel: "Case Studies",
    itemHrefPrefix: "/case-studies",
  },
  "white-paper": {
    noun: "white paper",
    section: "/white-papers",
    sectionLabel: "White Papers",
    itemHrefPrefix: "/white-papers",
  },
  "application": {
    noun: "application",
    section: "/applications",
    sectionLabel: "Applications",
    itemHrefPrefix: "/applications",
  },
  "model": {
    noun: "model",
    section: "/models",
    sectionLabel: "Models",
    itemHrefPrefix: "/models",
  },
  "polaris-episode": {
    noun: "episode",
    section: "/polaris",
    sectionLabel: "Polaris",
    itemHrefPrefix: "/polaris",
  },
  "workshop": {
    noun: "workshop",
    section: "/workshops",
    sectionLabel: "Workshops",
    itemHrefPrefix: "/workshops",
  },
  "service": {
    noun: "service",
    section: "/services-overview/default",
    sectionLabel: "Services",
    itemHrefPrefix: "/services",
  },
  "solution": {
    noun: "solution",
    section: "/services-overview/default",
    sectionLabel: "Solutions",
    itemHrefPrefix: "/solutions",
  },
};

interface LatestItem {
  slug: string;
  title: string;
  blurb?: string | null;
}

/** Sort by publishedAt desc when both are present, otherwise stable. */
function sortByPublished<T extends { publishedAt?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ad = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bd = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bd - ad;
  });
}

interface PolarisListResponse {
  items: Array<{
    slug: string;
    title: string;
    summary?: string | null;
    publishedAt?: string | null;
  }>;
}

interface InsightsListResponse {
  items: Array<{
    slug: string;
    title: string;
    excerpt?: string | null;
    subtitle?: string | null;
    publishedAt?: string | null;
  }>;
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function useLatestForKind(kind: GoneKind): {
  items: LatestItem[];
  isLoading: boolean;
  isError: boolean;
} {
  // Each branch must be called unconditionally so React Hooks order stays
  // stable. We enable only the relevant query via `enabled`.
  const insights = useQuery({
    queryKey: ["insights", "gone-latest"],
    queryFn: async (): Promise<InsightsListResponse> => {
      const res = await fetch(`${BASE_PATH}/api/insights?page=1&pageSize=3`);
      if (!res.ok) throw new Error(`insights ${res.status}`);
      return (await res.json()) as InsightsListResponse;
    },
    enabled: kind === "insight",
  });
  const caseStudies = useQuery({
    queryKey: ["case-studies", "gone-latest"],
    queryFn: () => api.listCaseStudies(),
    enabled: kind === "case-study",
  });
  const whitePapers = useQuery({
    queryKey: ["white-papers", "gone-latest"],
    queryFn: () => api.listWhitePapers({ page: 1, pageSize: 6 }),
    enabled: kind === "white-paper",
  });
  const applications = useQuery({
    queryKey: ["applications", "gone-latest"],
    queryFn: () => api.listApplications(),
    enabled: kind === "application",
  });
  const models = useQuery({
    queryKey: ["models", "gone-latest"],
    queryFn: () => api.listModels(),
    enabled: kind === "model",
  });
  const polaris = useQuery<PolarisListResponse>({
    queryKey: ["polaris-episodes", "gone-latest"],
    queryFn: async () => {
      const res = await fetch(`${BASE_PATH}/api/polaris/episodes?pageSize=10`);
      if (!res.ok) throw new Error(`polaris ${res.status}`);
      return (await res.json()) as PolarisListResponse;
    },
    enabled: kind === "polaris-episode",
  });
  const workshops = useQuery({
    queryKey: ["workshops", "gone-latest"],
    queryFn: () => workshopsApi.listPublic(),
    enabled: kind === "workshop",
  });
  const services = useQuery({
    queryKey: ["services", "gone-latest"],
    queryFn: () => api.listServices(),
    enabled: kind === "service" || kind === "solution",
  });

  switch (kind) {
    case "insight": {
      const items = (insights.data?.items ?? []).slice(0, 3).map((p) => ({
        slug: p.slug,
        title: p.title,
        blurb: p.excerpt ?? p.subtitle ?? null,
      }));
      return { items, isLoading: insights.isLoading, isError: insights.isError };
    }
    case "case-study": {
      const sorted = sortByPublished(caseStudies.data?.items ?? []);
      const items = sorted.slice(0, 3).map((c) => ({
        slug: c.slug,
        title: c.title,
        blurb: c.headline || c.summary || null,
      }));
      return { items, isLoading: caseStudies.isLoading, isError: caseStudies.isError };
    }
    case "white-paper": {
      const sorted = sortByPublished(whitePapers.data?.items ?? []);
      const items = sorted.slice(0, 3).map((w) => ({
        slug: w.slug,
        title: w.title,
        blurb: w.subtitle || w.shortDescription || null,
      }));
      return { items, isLoading: whitePapers.isLoading, isError: whitePapers.isError };
    }
    case "application": {
      const sorted = sortByPublished(applications.data?.items ?? []);
      const items = sorted.slice(0, 3).map((a) => ({
        slug: a.slug,
        title: a.title,
        blurb: a.tagline || a.shortSummary || null,
      }));
      return { items, isLoading: applications.isLoading, isError: applications.isError };
    }
    case "model": {
      const sorted = sortByPublished(models.data?.items ?? []);
      const items = sorted.slice(0, 3).map((m) => ({
        slug: m.slug,
        title: m.title,
        blurb: m.shortDescription || null,
      }));
      return { items, isLoading: models.isLoading, isError: models.isError };
    }
    case "polaris-episode": {
      const sorted = sortByPublished(polaris.data?.items ?? []);
      const items = sorted.slice(0, 3).map((e) => ({
        slug: e.slug,
        title: e.title,
        blurb: e.summary ?? null,
      }));
      return { items, isLoading: polaris.isLoading, isError: polaris.isError };
    }
    case "workshop": {
      const items = (workshops.data?.items ?? []).slice(0, 3).map((w) => ({
        slug: w.slug,
        title: w.title,
        blurb: w.shortDescription || null,
      }));
      return { items, isLoading: workshops.isLoading, isError: workshops.isError };
    }
    case "service": {
      const items = (services.data?.items ?? []).slice(0, 3).map((s) => ({
        slug: s.slug,
        title: s.title,
        blurb: null,
      }));
      return { items, isLoading: services.isLoading, isError: services.isError };
    }
    case "solution": {
      const all = (services.data?.items ?? []).flatMap((s) => s.solutions ?? []);
      const items = all.slice(0, 3).map((s) => ({
        slug: s.slug,
        title: s.title,
        blurb: null,
      }));
      return { items, isLoading: services.isLoading, isError: services.isError };
    }
  }
}

interface GoneProps {
  /** Section index to link back to, e.g. "/insights" or "/case-studies". */
  backHref?: string;
  /** Visible label for the back link. */
  backLabel?: string;
  /**
   * Editorial section the retired piece belonged to. When provided, the page
   * shows the latest 3 published items in that section and overrides
   * backHref/backLabel with the section's canonical defaults.
   */
  kind?: GoneKind;
}

export default function Gone({ backHref, backLabel, kind }: GoneProps) {
  useEffect(() => {
    // No traffic beacon: 410 is intentional, not a missing page.
  }, []);

  const meta = kind ? KIND_META[kind] : null;
  const resolvedBackHref = backHref ?? meta?.section ?? "/";
  const resolvedBackLabel =
    backLabel ?? (meta ? `Back to ${meta.sectionLabel}` : "Return home");
  const noun = meta?.noun ?? "page";

  return (
    <div
      className="relative w-full min-h-[80vh] overflow-hidden bg-[#0B0B1A]"
      data-testid="gone-page"
      data-gone-kind={kind ?? ""}
    >
      <Meta
        title="No longer available"
        description="This content has been retired."
        pageType="not-found"
      />
      <div className="absolute inset-0 nebula-gradient opacity-25" />
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 70% 60%, white, transparent), radial-gradient(1px 1px at 40% 80%, white, transparent), radial-gradient(2px 2px at 85% 20%, white, transparent), radial-gradient(1px 1px at 10% 70%, white, transparent), radial-gradient(1px 1px at 55% 15%, white, transparent)",
          backgroundSize: "100% 100%",
        }}
      />
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-20">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-white/10 border border-white/20 text-white flex items-center justify-center mb-8 backdrop-blur">
            <Archive className="h-7 w-7" />
          </div>
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            410 — retired from the constellation
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
            This {noun} is no longer available.
          </h1>
          <p className="text-lg text-zinc-300 max-w-2xl mx-auto mb-10">
            Sorry — we&apos;ve retired the content that lived at this address.
            {meta
              ? ` Here are the latest from ${meta.sectionLabel}.`
              : " Try one of the latest pieces from the site instead."}
          </p>
          <Link
            href={resolvedBackHref}
            data-testid="gone-back-link"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            {resolvedBackLabel}
          </Link>
        </div>

        {kind && meta && <LatestRail kind={kind} meta={meta} />}
      </div>
    </div>
  );
}

function LatestRail({ kind, meta }: { kind: GoneKind; meta: KindMeta }) {
  const { items, isLoading, isError } = useLatestForKind(kind);
  if (isError) {
    return (
      <section
        className="mt-16 text-center"
        data-testid="gone-latest-rail-error"
      >
        <p className="text-sm text-zinc-400">
          We couldn&apos;t load the latest in {meta.sectionLabel}.{" "}
          <Link
            href={meta.section}
            className="text-primary hover:underline"
          >
            Browse the section index
          </Link>
          .
        </p>
      </section>
    );
  }
  if (!isLoading && items.length === 0) return null;
  return (
    <section
      className="mt-16"
      aria-labelledby="gone-latest-heading"
      data-testid="gone-latest-rail"
    >
      <h2
        id="gone-latest-heading"
        className="text-xs uppercase tracking-widest text-zinc-400 mb-4 text-center"
      >
        Latest in {meta.sectionLabel}
      </h2>
      {isLoading ? (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          aria-hidden="true"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-white/10 bg-white/5 h-28 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((item) => (
            <li key={`${kind}-${item.slug}`}>
              <Link
                href={`${meta.itemHrefPrefix}/${item.slug}`}
                className="group block h-full rounded-lg border border-white/10 bg-white/5 p-4 hover:border-white/30 hover:bg-white/10 transition-colors"
                data-testid="gone-latest-item"
              >
                <div className="text-xs uppercase tracking-widest text-primary mb-2">
                  {meta.sectionLabel}
                </div>
                <div className="text-base font-medium text-white leading-snug line-clamp-2">
                  {item.title}
                </div>
                {item.blurb && (
                  <div className="mt-2 text-xs text-zinc-400 line-clamp-2">
                    {item.blurb}
                  </div>
                )}
                <div className="mt-3 inline-flex items-center text-sm text-zinc-300 group-hover:text-white">
                  Read <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
