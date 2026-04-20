import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Headphones, Play, Mail, ArrowRight } from "lucide-react";

type Episode = {
  number: string;
  title: string;
  releaseDate: string;
  durationMin: number;
  image: string;
  appleUrl: string;
  audioUrl: string;
  description: string;
};

const episodes: Episode[] = [
  {
    number: "53",
    title: "Inside Microsoft 365 E7, Or, How Four Equals Seven",
    releaseDate: "March 24, 2026",
    durationMin: 16,
    image: "/images/polaris/ep-m365-e7.jpg",
    appleUrl:
      "https://podcasts.apple.com/us/podcast/inside-microsoft-365-e7-or-how-four-equals-seven/id1773172041?i=1000757146174",
    audioUrl:
      "https://traffic.libsyn.com/secure/4b50c5db-fc98-4391-b363-96ab432ae6e1/riverside_ep.053_-m365-e7_chris_mcnultys_stu.mp3?dest-id=4755027",
    description:
      "We explore Microsoft's game-changing March 2026 announcements — including the Microsoft 365 E7 \"Frontier Suite,\" Agent 365 for AI governance, and the new Copilot Cowork capability — and unpack what these innovations mean for business and technology leaders navigating the AI-powered future.",
  },
  {
    number: "51",
    title: "AI in 2026: A Trillion Dollars Is Coming. Who's Going to Win It?",
    releaseDate: "March 17, 2026",
    durationMin: 15,
    image: "/images/polaris/ep-ai-2026.png",
    appleUrl:
      "https://podcasts.apple.com/us/podcast/ai-in-2026-a-trillion-dollars-is-coming-whos-going-to-win-it/id1773172041?i=1000755875857",
    audioUrl:
      "https://traffic.libsyn.com/secure/4b50c5db-fc98-4391-b363-96ab432ae6e1/riverside_ep.051_-_chris_final_final_final_chris_mcnultys_stu.mp3?dest-id=4755027",
    description:
      "The global AI market is on track to reach nearly a trillion dollars by 2030. And yet, most organizations sit at a score of 260 out of 500 on AI maturity — past the experiment phase, but nowhere near scaled. That's the core finding of the Synozur 2026 AI Report, and it's also the subject of the latest episode of Polaris Pulse.",
  },
  {
    number: "33",
    title: "Never Sit in the Lobby: Glenn Poulos on Sales, Startups, and Survival",
    releaseDate: "March 10, 2026",
    durationMin: 40,
    image: "/images/polaris/ep-glenn-poulos.jpg",
    appleUrl:
      "https://podcasts.apple.com/us/podcast/never-sit-in-the-lobby-glenn-poulos-on-sales-startups/id1773172041?i=1000754582564",
    audioUrl:
      "https://traffic.libsyn.com/secure/4b50c5db-fc98-4391-b363-96ab432ae6e1/riverside_polaris_033_-_glenn_poulos_final_final_chris_mcnultys_stu.mp3?dest-id=4755027",
    description:
      "Polaris is a production of Synozur — the transformation company. Glenn Poulos, co-founder of Gap Wireless and author of Never Sit in the Lobby, shares how he built and sold multiple businesses across three decades, reveals why face-to-face relationships still matter in the AI age, and explains how mid-market companies can leverage technology without losing their human touch.",
  },
];

const subscriptions = [
  {
    name: "Apple Podcasts",
    url: "https://podcasts.apple.com/us/podcast/polaris-pathways-a-synozur-podcast/id1773172041",
  },
  {
    name: "Spotify",
    url: "https://open.spotify.com/show/1cEtlJsybYcFFGTiKU1pX6?si=6faafd668eb44d5b",
  },
  {
    name: "Amazon Music",
    url: "https://music.amazon.com/podcasts/db9939ac-8343-420e-97c3-ee09eae50c74/polaris-pathways---a-synozur-podcast",
  },
  {
    name: "YouTube",
    url: "https://www.youtube.com/@SynozurVideos",
  },
  {
    name: "RSS",
    url: "https://rss.libsyn.com/shows/550947/destinations/4755027.xml",
  },
];

export default function Polaris() {
  return (
    <div className="w-full">
      <Meta
        title="Polaris Podcast"
        description="Polaris Pathways, our podcast, charts the course for business, leadership and technology transformation. You can also find us on Apple, Spotify, Amazon, or wherever you get your favorite podcasts."
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B0B1A] py-28 md:py-32">
        <div className="absolute inset-0 nebula-gradient opacity-30" />
        <div className="container relative z-10 mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <p className="text-sm uppercase tracking-widest text-primary mb-4 inline-flex items-center gap-2">
              <Headphones className="h-4 w-4" />
              Polaris Pathways
            </p>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
              Polaris Pathways Podcast
            </h1>
            <p className="text-lg md:text-xl text-zinc-300 leading-relaxed max-w-2xl">
              All our episodes are shared below. You can also find us on Apple,
              Spotify, Amazon, YouTube or wherever you get your favorite
              podcasts. And you can subscribe to be alerted when we add new
              episodes.
            </p>
            <p className="mt-5 text-base md:text-lg text-zinc-400 leading-relaxed max-w-2xl">
              Synozur's name is inspired by the ancient Greek term for the North
              Star, symbolizing our unwavering commitment to guiding our clients
              to success. Polaris Pathways, our podcast, charts the course for
              business, leadership and technology transformation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {subscriptions.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 hover:border-primary/60 transition-colors"
                >
                  {s.name}
                </a>
              ))}
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="relative aspect-square rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10">
              <img
                src="/images/polaris/show.jpg"
                alt="Polaris Pathways — a Synozur podcast"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Featured episodes */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Episodes
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Latest conversations
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {episodes.map((e, i) => (
              <motion.article
                key={e.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="group flex flex-col rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
              >
                <div className="relative aspect-square overflow-hidden bg-card">
                  <img
                    src={e.image}
                    alt={e.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                  <div className="absolute top-5 left-5 text-white/90 text-xs uppercase tracking-widest">
                    Episode {e.number}
                  </div>
                  <div className="absolute bottom-5 right-5">
                    <a
                      href={e.appleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-14 w-14 rounded-full bg-white/95 text-[#0B0B1A] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform"
                      aria-label={`Listen to: ${e.title}`}
                    >
                      <Play className="h-5 w-5 ml-0.5 fill-current" />
                    </a>
                  </div>
                </div>
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="text-lg font-bold leading-snug mb-3 group-hover:text-primary transition-colors">
                    {e.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1">
                    {e.description}
                  </p>
                  <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
                    <span>{e.releaseDate}</span>
                    <span>{e.durationMin} min</span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* Polaris Subscriptions */}
      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 border-t border-white/10">
        <div className="absolute inset-0 nebula-gradient opacity-20" />
        <div className="container relative z-10 mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Subscribe
            </p>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-5">
              Polaris Subscriptions
            </h2>
            <p className="text-lg text-zinc-300 leading-relaxed max-w-xl">
              Sign up with your email address to be advised as we release new
              episodes (about monthly).
            </p>
            <p className="mt-4 text-sm text-zinc-400 max-w-xl">
              By submitting your contact information, you consent to receive
              information, tips, and offers about products and services from
              Synozur and/or its partners. You can unsubscribe at any time.
            </p>
            <p className="mt-3 text-sm text-zinc-400">
              We respect your privacy. Learn more about how we use your data at{" "}
              <a
                href="https://www.synozur.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                www.synozur.com/privacy
              </a>
              .
            </p>
          </div>
          <div className="lg:col-span-5">
            <form
              className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-sm"
              onSubmit={(ev) => ev.preventDefault()}
            >
              <label
                htmlFor="polaris-firstName"
                className="block text-xs uppercase tracking-widest text-zinc-400 mb-2"
              >
                First name
              </label>
              <input
                id="polaris-firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                className="w-full rounded-md bg-white/10 border border-white/15 px-3 py-2.5 text-white placeholder:text-zinc-500 mb-4 focus:outline-none focus:border-primary"
                placeholder="Your first name"
              />
              <label
                htmlFor="polaris-lastName"
                className="block text-xs uppercase tracking-widest text-zinc-400 mb-2"
              >
                Last name
              </label>
              <input
                id="polaris-lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                className="w-full rounded-md bg-white/10 border border-white/15 px-3 py-2.5 text-white placeholder:text-zinc-500 mb-4 focus:outline-none focus:border-primary"
                placeholder="Your last name"
              />
              <label
                htmlFor="polaris-email"
                className="block text-xs uppercase tracking-widest text-zinc-400 mb-2"
              >
                Email
              </label>
              <input
                id="polaris-email"
                name="email"
                type="email"
                autoComplete="email"
                className="w-full rounded-md bg-white/10 border border-white/15 px-3 py-2.5 text-white placeholder:text-zinc-500 mb-5 focus:outline-none focus:border-primary"
                placeholder="you@company.com"
              />
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-3 font-semibold hover:bg-primary/90 transition-colors"
              >
                Subscribe <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Guest CTA */}
      <section className="bg-card border-t border-border py-20">
        <div className="container mx-auto px-4 max-w-2xl text-center">
          <Mail className="h-8 w-8 text-primary mx-auto mb-5" />
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Interested in joining a future episode?
          </h2>
          <p className="text-muted-foreground mb-6">
            Contact us at{" "}
            <a
              href="mailto:polaris@synozur.com"
              className="text-primary hover:underline"
            >
              polaris@synozur.com
            </a>{" "}
            for more details. Thanks.
          </p>
        </div>
      </section>
    </div>
  );
}
