import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Meta } from "@/lib/meta";
import { api, type ModelDto } from "@/lib/api";
import NotFound from "@/pages/not-found";

export default function ModelDetail() {
  const { slug } = useParams<{ slug: string }>();
  const modelQ = useQuery<ModelDto>({
    queryKey: ["model", slug],
    queryFn: () => api.getModel(slug!),
    enabled: Boolean(slug),
    retry: false,
  });

  if (modelQ.isLoading) {
    return (
      <div className="container mx-auto px-4 py-24 text-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  const m = modelQ.data;
  if (!m) return <NotFound />;

  return (
    <div className="w-full">
      <Meta
        title={m.seoTitle || `${m.title} | Maturity Models`}
        description={m.seoDescription || m.shortDescription}
        path={`/models/${m.slug}`}
        image={m.ogImage || m.heroImage || null}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/models"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> All models
          </Link>
          {m.pillar && (
            <p className="text-sm uppercase tracking-widest text-primary mb-4">
              {m.pillar}
            </p>
          )}
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white mb-6">
            {m.title}
          </h1>
          {m.shortDescription && (
            <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl mb-8">
              {m.shortDescription}
            </p>
          )}
          {m.launchUrl && (
            <a
              href={m.launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              data-testid="model-launch-cta"
            >
              Launch assessment
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          )}
        </div>
      </section>

      {m.heroImage && (
        <section className="bg-background">
          <div className="container mx-auto px-4 max-w-5xl -mt-12 relative z-10">
            <img
              src={m.heroImage}
              alt={m.title}
              className="w-full rounded-2xl border border-border shadow-xl"
            />
          </div>
        </section>
      )}

      {m.longDescriptionHtml && (
        <section className="py-20 bg-background">
          <div className="container mx-auto px-4 max-w-3xl">
            <div
              className="prose prose-lg dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: m.longDescriptionHtml }}
            />
          </div>
        </section>
      )}

      {m.dimensionsHtml && (
        <section className="py-20 bg-card border-t border-border">
          <div className="container mx-auto px-4 max-w-3xl">
            <h2 className="text-3xl font-bold mb-6">Levels and dimensions</h2>
            <div
              className="prose prose-lg dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: m.dimensionsHtml }}
            />
          </div>
        </section>
      )}

      {m.relatedInformation.length > 0 && (
        <section className="py-20 bg-background border-t border-border">
          <div className="container mx-auto px-4 max-w-3xl">
            <h2 className="text-3xl font-bold mb-6">Related</h2>
            <ul className="space-y-3">
              {m.relatedInformation.map((r, i) => (
                <li key={`${r.url}-${i}`}>
                  <a
                    href={r.url}
                    className="inline-flex items-center text-primary hover:underline"
                    target={r.url.startsWith("http") ? "_blank" : undefined}
                    rel={
                      r.url.startsWith("http") ? "noopener noreferrer" : undefined
                    }
                  >
                    {r.label}
                    {r.url.startsWith("http") && (
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {m.launchUrl && (
        <section className="py-20 bg-card border-t border-border text-center">
          <div className="container mx-auto px-4 max-w-2xl">
            <h2 className="text-3xl font-bold mb-4">Ready to assess?</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Run the {m.title} self-assessment and see where you stand.
            </p>
            <a
              href={m.launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Launch assessment
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
