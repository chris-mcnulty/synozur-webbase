import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { FileText, BookOpen } from "lucide-react";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
import {
  api,
  WHITE_PAPER_DOC_TYPES,
  type WhitePaperDocType,
  type WhitePaperDto,
  type WhitePaperListResult,
} from "@/lib/api";

const PAGE_SIZE = 12;

const DOC_TYPE_LABELS: Record<WhitePaperDocType, string> = {
  whitepaper: "White Paper",
  ebook: "eBook",
  report: "Report",
  guide: "Guide",
};

function iconForType(t: WhitePaperDocType) {
  if (t === "ebook") return BookOpen;
  return FileText;
}

function WhitePaperCard({ item }: { item: WhitePaperDto }) {
  const Icon = iconForType(item.docType);
  return (
    <Link href={`/white-papers/${item.slug}`}>
      <a
        className="group block rounded-2xl overflow-hidden border border-border/60 bg-card hover:border-primary/40 transition-colors"
        data-testid={`card-white-paper-${item.slug}`}
      >
        <div className="aspect-[16/9] relative overflow-hidden bg-muted">
          {item.heroImage ? (
            <img
              src={item.heroImage}
              alt={item.heroImageAlt || item.title}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Icon className="h-12 w-12" />
            </div>
          )}
          <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-white text-[10px] tracking-[0.2em] uppercase font-semibold">
            <Icon className="h-3 w-3" />
            {DOC_TYPE_LABELS[item.docType]}
          </div>
        </div>
        <div className="p-5">
          {item.subtitle && (
            <p className="text-xs uppercase tracking-[0.15em] text-primary mb-2">
              {item.subtitle}
            </p>
          )}
          <h3 className="font-semibold text-lg leading-snug mb-2 group-hover:text-primary transition-colors line-clamp-2">
            {item.title}
          </h3>
          {item.shortDescription && (
            <p className="text-sm text-muted-foreground line-clamp-3">
              {item.shortDescription}
            </p>
          )}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {item.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.15em] bg-muted border border-border text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </a>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-border/60 bg-card">
      <div className="aspect-[16/9] bg-muted animate-pulse" />
      <div className="p-5 space-y-3">
        <div className="h-5 bg-muted rounded animate-pulse" />
        <div className="h-4 bg-muted rounded w-4/5 animate-pulse" />
        <div className="h-4 bg-muted rounded w-3/5 animate-pulse" />
      </div>
    </div>
  );
}

export default function WhitePapers() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => new URLSearchParams(search), [search, location]);
  const docTypeParam = params.get("docType") ?? "";
  const docType = (WHITE_PAPER_DOC_TYPES as readonly string[]).includes(docTypeParam)
    ? (docTypeParam as WhitePaperDocType)
    : undefined;
  const q = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [result, setResult] = useState<WhitePaperListResult | null>(null);
  const [qInput, setQInput] = useState(q);

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    api
      .listWhitePapers({ docType, q: q || undefined, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult({ total: 0, page, pageSize: PAGE_SIZE, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [docType, q, page]);

  function setDocType(next: WhitePaperDocType | "") {
    const n = new URLSearchParams();
    if (next) n.set("docType", next);
    if (q) n.set("q", q);
    navigate(`/white-papers${n.toString() ? `?${n.toString()}` : ""}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const n = new URLSearchParams();
    if (docType) n.set("docType", docType);
    if (qInput.trim()) n.set("q", qInput.trim());
    navigate(`/white-papers${n.toString() ? `?${n.toString()}` : ""}`);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  const copy = useParentPage("white-papers", {
    heroEyebrow: "White Papers & eBooks",
    heroHeadline: "Deep dives & playbooks",
    heroSubhead:
      "Research, frameworks, and practical guides from the Synozur team — downloadable for reference or team sharing.",
    seoTitle: "White Papers & eBooks",
    seoDescription:
      "In-depth white papers, reports, and eBooks from the Synozur team on transformation, AI, and the digital workplace.",
  });

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/white-papers"
        image={copy.ogImage}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-12">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-6xl">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">
            {copy.heroEyebrow}
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-4">
            {copy.heroHeadline}
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-3xl">
            {copy.heroSubhead}
          </p>
          {copy.introHtml && (
            <div
              className="prose prose-invert max-w-3xl mt-6 text-zinc-300"
              dangerouslySetInnerHTML={{ __html: copy.introHtml }}
            />
          )}
        </div>
      </section>

      <section className="bg-background py-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="mb-8 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDocType("")}
                className={
                  "px-3 py-1.5 rounded-full text-sm border transition-colors " +
                  (!docType
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground")
                }
                data-testid="filter-wp-all"
              >
                All
              </button>
              {WHITE_PAPER_DOC_TYPES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDocType(c)}
                  className={
                    "px-3 py-1.5 rounded-full text-sm border transition-colors " +
                    (docType === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground")
                  }
                  data-testid={`filter-wp-${c}`}
                >
                  {DOC_TYPE_LABELS[c]}
                </button>
              ))}
            </div>
            <form onSubmit={submitSearch} className="flex items-center gap-2">
              <label htmlFor="wp-search" className="sr-only">
                Search white papers
              </label>
              <input
                id="wp-search"
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search…"
                className="px-3 py-2 rounded-md border border-border bg-card text-sm w-64"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
              >
                Search
              </button>
            </form>
          </div>

          {!result ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : result.items.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
              {q
                ? `No white papers match “${q}”${docType ? ` in ${DOC_TYPE_LABELS[docType]}` : ""}.`
                : "No white papers yet."}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {result.items.map((item) => (
                  <WhitePaperCard key={item.id} item={item} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-10">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => {
                      const next = new URLSearchParams(search);
                      next.set("page", String(page - 1));
                      navigate(`/white-papers?${next.toString()}`);
                    }}
                    className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-40 hover:bg-muted"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => {
                      const next = new URLSearchParams(search);
                      next.set("page", String(page + 1));
                      navigate(`/white-papers?${next.toString()}`);
                    }}
                    className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-40 hover:bg-muted"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
