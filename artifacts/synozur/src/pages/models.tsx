import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Meta } from "@/lib/meta";
import { useParentPage } from "@/lib/parent-page";
import { api, type ModelDto } from "@/lib/api";

export default function Models() {
  const listQ = useQuery({
    queryKey: ["models"],
    queryFn: () => api.listModels(),
  });

  const items: ModelDto[] = listQ.data?.items ?? [];

  const copy = useParentPage("models", {
    heroEyebrow: "Frameworks",
    heroHeadline: "Maturity models",
    heroSubhead:
      "Every Synozur engagement is grounded in a published maturity model. Run a self-assessment on any model — AI, KMMM, GTM, Content, Company OS — and see where your organization sits before you call us.",
    seoTitle: "Maturity Models",
    seoDescription:
      "AI, KMMM, GTM, Content Management, and Company OS maturity models from The Synozur Alliance.",
  });

  return (
    <div className="w-full">
      <Meta
        title={copy.seoTitle}
        description={copy.seoDescription}
        path="/models"
        image={copy.ogImage}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            {copy.heroEyebrow}
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            {copy.heroHeadline}
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
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

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          {listQ.isLoading ? (
            <div className="text-center text-muted-foreground py-20">
              Loading models…
            </div>
          ) : items.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-border bg-card/50 py-20 text-center px-6"
              data-testid="models-empty"
            >
              <h2 className="text-2xl font-semibold mb-3">No models yet</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                New maturity models appear here as they're published.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {items.map((m, i) => (
                <motion.article
                  key={m.slug}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
                  data-testid={`model-card-${m.slug}`}
                >
                  <Link href={`/models/${m.slug}`} className="block">
                    {m.heroImage ? (
                      <div className="relative aspect-[4/3] overflow-hidden">
                        <img
                          src={m.heroImage}
                          alt={m.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      </div>
                    ) : (
                      <div className="aspect-[4/3] bg-gradient-to-br from-primary/20 to-primary/5" />
                    )}
                    <div className="p-7">
                      {m.pillar && (
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                          {m.pillar}
                        </p>
                      )}
                      <h2 className="text-xl font-bold mb-3 leading-snug group-hover:text-primary transition-colors">
                        {m.title}
                      </h2>
                      <p className="text-muted-foreground mb-6 leading-relaxed line-clamp-3">
                        {m.shortDescription}
                      </p>
                      <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary">
                        Explore{" "}
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
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
