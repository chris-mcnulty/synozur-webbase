import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { Check, Rss, BookOpen, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";

const benefits = [
  {
    icon: BookOpen,
    title: "Original analysis",
    description:
      "In-depth perspectives on strategy, technology, and the forces reshaping modern enterprises — written by practitioners, not marketers.",
  },
  {
    icon: Zap,
    title: "Signal over noise",
    description:
      "A curated digest of what actually matters across AI, transformation, and go-to-market — no filler, no fluff.",
  },
  {
    icon: Rss,
    title: "Exclusive content",
    description:
      "Early access to Synozur research, event invites, and resources before they reach the public.",
  },
];

export default function Join() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error" | "bot-check-failed"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus("error");
      setErrorMessage("Please complete the bot check before subscribing.");
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      await api.submitSubscribe({
        email,
        source: "join-page",
        website: website || null,
        turnstileToken,
      });
      setStatus("success");
    } catch (err) {
      if (isBotCheckError(err)) {
        setStatus("bot-check-failed");
        setErrorMessage(null);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setStatus("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not subscribe. Please try again.",
      );
    }
  };

  return (
    <div className="w-full">
      <Meta
        title="Join The Feed"
        description="Subscribe to The Feed — Synozur's newsletter on strategy, technology transformation, and the ideas shaping modern enterprise."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            The Feed
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Join The Feed.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-2xl">
            Synozur's newsletter for leaders navigating transformation. Straight
            to your inbox — no noise, no cadence bloat.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-16 max-w-6xl">
          <div className="lg:col-span-5 space-y-8">
            <div>
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                What you get
              </p>
              <h2 className="text-2xl font-bold mb-6">
                Built for practitioners
              </h2>
              <div className="space-y-6">
                {benefits.map(({ icon: Icon, title, description }) => (
                  <div key={title} className="flex gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold mb-1">{title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            {status === "success" ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-12 text-center"
              >
                <div className="absolute inset-0 nebula-gradient opacity-15" />
                <div className="relative">
                  <div className="mx-auto h-16 w-16 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-6">
                    <Check className="h-8 w-8" />
                  </div>
                  <h2 className="text-3xl font-bold mb-4">You're in.</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Welcome to The Feed. You'll hear from us with the next
                    edition — no spam, unsubscribe anytime.
                  </p>
                </div>
              </motion.div>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-border/60 bg-card p-8 md:p-10 space-y-6"
              >
                <div>
                  <h2 className="text-xl font-bold mb-1">Subscribe now</h2>
                  <p className="text-sm text-muted-foreground">
                    One email address is all it takes. Unsubscribe at any time.
                  </p>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="join-email"
                    className="text-sm font-medium leading-none"
                  >
                    Email address
                  </label>
                  <Input
                    id="join-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
                />
                <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
                {status === "bot-check-failed" && <BotCheckCallout />}
                {status === "error" && errorMessage && (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={status === "submitting"}
                  className="w-full md:w-auto"
                >
                  {status === "submitting" ? "Subscribing..." : "Join The Feed"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
