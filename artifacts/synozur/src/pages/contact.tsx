import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Mail, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/traffic-tracker";
import {
  Turnstile,
  TURNSTILE_SITE_KEY,
  isBotCheckError,
  type TurnstileHandle,
} from "@/components/turnstile";
import { BotCheckCallout } from "@/components/bot-check-callout";

const schema = z.object({
  name: z.string().min(2, "Please share your name"),
  company: z.string().min(2, "Please share your company"),
  email: z.string().email("Please share a valid email"),
  message: z.string().min(10, "A few sentences helps us route this well"),
  website: z.string().optional(),
  marketingOptIn: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setSubmitError(null);
    setBotCheckFailed(false);
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setSubmitError("Please complete the bot check before sending.");
      return;
    }
    try {
      await api.submitContact(
        {
          name: data.name,
          company: data.company,
          email: data.email,
          message: data.message,
          website: data.website ?? null,
          turnstileToken,
        },
        { marketingOptIn: data.marketingOptIn === true },
      );
      setSubmitted(true);
      void trackEvent("contact-form-submit", {
        company: data.company.slice(0, 120) || null,
      });
    } catch (err) {
      if (isBotCheckError(err)) {
        setBotCheckFailed(true);
        setTurnstileToken(null);
        turnstileRef.current?.reset();
        return;
      }
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again or email hello@synozur.com.",
      );
    }
  };

  return (
    <div className="w-full">
      <Meta
        title="Contact"
        description="Tell us where you are headed. We will tell you where Synozur can help."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Contact
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Start the conversation.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-2xl">
            Tell us about the work you are doing. We read every message and reply
            personally — usually within two business days.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-16">
          <div className="lg:col-span-5 space-y-8">
            <div>
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                Reach us directly
              </p>
              <h2 className="text-2xl font-bold mb-6">Office</h2>
              <div className="space-y-4 text-muted-foreground">
                <div className="flex gap-3">
                  <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span>hello@synozur.com</span>
                </div>
                <div className="flex gap-3">
                  <MapPin className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span>Operating across North America &amp; EMEA.</span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card p-8">
              <h3 className="font-bold mb-2">Looking to join?</h3>
              <p className="text-sm text-muted-foreground">
                We are quietly hiring senior practitioners. Tell us about your
                background and what you would want to work on.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7">
            {submitted ? (
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
                  <h2 className="text-3xl font-bold mb-4">Thank you.</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Your note is on its way to our partner team. We will be in touch
                    personally within two business days.
                  </p>
                </div>
              </motion.div>
            ) : (
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="rounded-2xl border border-border/60 bg-card p-8 md:p-10 space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="Your name" {...register("name")} />
                    {errors.name && (
                      <p className="text-sm text-destructive">{errors.name.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input id="company" placeholder="Company" {...register("company")} />
                    {errors.company && (
                      <p className="text-sm text-destructive">{errors.company.message}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="you@company.com" {...register("email")} />
                  {errors.email && (
                    <p className="text-sm text-destructive">{errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">What are you working on?</Label>
                  <Textarea
                    id="message"
                    rows={6}
                    placeholder="A few sentences about the situation, the team, and where you would want help."
                    {...register("message")}
                  />
                  {errors.message && (
                    <p className="text-sm text-destructive">{errors.message.message}</p>
                  )}
                </div>
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
                  {...register("website")}
                />
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-1"
                    {...register("marketingOptIn")}
                  />
                  <span>
                    Keep me posted on Synozur insights and announcements. You
                    can unsubscribe at any time.
                  </span>
                </label>
                <Turnstile ref={turnstileRef} onVerify={setTurnstileToken} />
                {botCheckFailed && <BotCheckCallout />}
                {submitError && (
                  <p className="text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}
                <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
                  {isSubmitting ? "Sending..." : "Send message"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
