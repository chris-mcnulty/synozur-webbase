import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Clock, Monitor } from "lucide-react";
import { workshopsApi, type WorkshopDto } from "@/lib/api-workshops";
import { cn } from "@/lib/utils";

const ALL = "All";

export default function Workshops() {
  const [category, setCategory] = useState<string>(ALL);

  const { data, isLoading } = useQuery({
    queryKey: ["public-workshops"],
    queryFn: () => workshopsApi.listPublic(),
  });
  const workshops: WorkshopDto[] = data?.items ?? [];

  const categories = useMemo(
    () => [ALL, ...Array.from(new Set(workshops.map((w) => w.category).filter(Boolean)))],
    [workshops],
  );

  const filtered = useMemo(
    () => workshops.filter((w) => category === ALL || w.category === category),
    [category, workshops],
  );

  const isFiltered = category !== ALL;

  return (
    <div className="w-full">
      <Meta title="Workshops" />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white">
            Workshops
          </h1>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="mb-10 space-y-5" data-testid="workshop-filters">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-muted-foreground sm:w-24 shrink-0">
                Category
              </span>
              <div className="flex flex-wrap gap-2">
                {categories.map((option) => {
                  const isActive = option === category;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setCategory(option)}
                      aria-pressed={isActive}
                      className={cn(
                        "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:border-primary/50 hover:text-primary",
                      )}
                      data-testid={`filter-category-${option
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, "")}`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
              <p
                className="text-sm text-muted-foreground"
                data-testid="workshop-count"
              >
                Showing {filtered.length} of {workshops.length}{" "}
                {workshops.length === 1 ? "workshop" : "workshops"}
              </p>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => setCategory(ALL)}
                  className="text-sm font-medium text-primary hover:underline"
                  data-testid="filter-reset"
                >
                  Reset filter
                </button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div
              className="rounded-2xl border border-dashed border-border bg-card/50 py-20 text-center px-6"
              data-testid="workshop-loading"
            >
              <p className="text-muted-foreground">Loading workshops…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-border bg-card/50 py-20 text-center px-6"
              data-testid="workshop-empty"
            >
              <p className="text-muted-foreground mb-6">
                No workshops match this filter.
              </p>
              <button
                type="button"
                onClick={() => setCategory(ALL)}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                data-testid="filter-reset-empty"
              >
                Reset filter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filtered.map((w, i) => (
                <motion.article
                  key={w.slug}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors flex flex-col"
                >
                  <Link
                    href={`/workshops/${w.slug}`}
                    className="block flex flex-col h-full"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden">
                      <img
                        src={w.heroImage}
                        alt={w.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-6">
                        <span className="inline-block py-1 px-3 rounded-full bg-primary/30 border border-primary/40 text-white text-xs font-medium backdrop-blur-md">
                          {w.category}
                        </span>
                      </div>
                    </div>
                    <div className="p-7 flex flex-col flex-1">
                      <h2 className="text-xl font-bold mb-3 leading-snug group-hover:text-primary transition-colors">
                        {w.title}
                      </h2>
                      <p className="text-muted-foreground mb-6 leading-relaxed line-clamp-3">
                        {w.shortDescription}
                      </p>
                      <div className="mt-auto space-y-3">
                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" /> {w.duration}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Monitor className="h-3.5 w-3.5" />{" "}
                            {w.deliveryFormat}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-4 border-t border-border/50">
                          <span className="text-sm font-semibold text-primary leading-tight pr-3">
                            {w.price.display}
                          </span>
                          <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary shrink-0">
                            Learn more{" "}
                            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
