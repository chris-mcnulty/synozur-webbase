import { Meta } from "@/lib/meta";
import { BookOpen, Mic, FileText, CalendarDays, Mail } from "lucide-react";
import { SubscribeForm } from "@/components/subscribe/SubscribeForm";

// The subscription center — one place to manage what Synozur sends you.
// Consolidates the former /join page and the scattered inline subscribe forms.
// /join now redirects here (see App.tsx).

const benefits = [
  {
    icon: BookOpen,
    title: "Blog",
    description:
      "In-depth analysis on strategy, AI, and transformation — written by practitioners, not marketers.",
  },
  {
    icon: Mic,
    title: "Polaris Podcast",
    description: "New episodes with the operators and leaders navigating change.",
  },
  {
    icon: FileText,
    title: "White papers",
    description: "Original research and practical guides, the moment they publish.",
  },
  {
    icon: CalendarDays,
    title: "Events",
    description: "Webinars, workshops, and briefings — with early registration.",
  },
  {
    icon: Mail,
    title: "Newsletter",
    description: "A monthly digest of what actually matters. No filler, no cadence bloat.",
  },
];

export default function Subscribe() {
  return (
    <div className="w-full">
      <Meta
        title="Subscribe"
        description="Choose what Synozur sends you — Blog, Polaris Podcast, white papers, events, and the monthly newsletter. One place, unsubscribe anytime."
        path="/subscribe"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-28">
        <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto max-w-4xl px-4">
          <p className="mb-4 text-sm uppercase tracking-widest text-primary">
            Subscription center
          </p>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-white md:text-6xl">
            Get exactly what you want from Synozur.
          </h1>
          <p className="max-w-2xl text-xl leading-relaxed text-zinc-300">
            One email address, your choice of topics. Confirm once and
            unsubscribe anytime — no noise, no cadence bloat.
          </p>
        </div>
      </section>

      <section className="bg-background py-20 md:py-24">
        <div className="container mx-auto grid max-w-6xl grid-cols-1 gap-14 px-4 lg:grid-cols-12">
          <div className="space-y-8 lg:col-span-5">
            <div>
              <p className="mb-3 text-sm uppercase tracking-widest text-primary">
                What you can get
              </p>
              <h2 className="mb-6 text-2xl font-bold">Pick your channels</h2>
              <div className="space-y-6">
                {benefits.map(({ icon: Icon, title, description }) => (
                  <div key={title} className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="mb-1 font-semibold">{title}</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <SubscribeForm
              source="subscribe-center"
              heading="Choose your subscriptions"
              subcopy="Tick the topics you want. We'll send a single email to confirm."
              submitLabel="Subscribe"
              defaultTopics={["blog", "newsletter"]}
              successHeading="You're in."
              successBody="Check your inbox to confirm. You can update your choices from any email footer."
            />
          </div>
        </div>
      </section>
    </div>
  );
}
