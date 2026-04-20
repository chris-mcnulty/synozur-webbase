import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(2, "Your name, please"),
  company: z.string().min(2, "Your company, please"),
  email: z.string().email("A valid email, please"),
  role: z.string().min(2, "Your role, please"),
  pillar: z.enum([
    "Strategic Transformation",
    "Technology Transformation",
    "Experiences",
    "Go-to-Market Transformation",
    "Not sure yet",
  ]),
  timeline: z.enum(["Immediate", "This quarter", "Next quarter", "Exploring"]),
  budget: z.enum(["< $250k", "$250k – $1M", "$1M – $5M", "$5M+", "Not yet defined"]),
  brief: z.string().min(20, "A short brief helps us route this to the right partner"),
});

type FormData = z.infer<typeof schema>;

const pillars: FormData["pillar"][] = [
  "Strategic Transformation",
  "Technology Transformation",
  "Experiences",
  "Go-to-Market Transformation",
  "Not sure yet",
];
const timelines: FormData["timeline"][] = ["Immediate", "This quarter", "Next quarter", "Exploring"];
const budgets: FormData["budget"][] = ["< $250k", "$250k – $1M", "$1M – $5M", "$5M+", "Not yet defined"];

export default function Start() {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { pillar: "Not sure yet", timeline: "Exploring", budget: "Not yet defined" },
  });

  const onSubmit = async (_data: FormData) => {
    await new Promise((r) => setTimeout(r, 700));
    setSubmitted(true);
  };

  return (
    <div className="w-full">
      <Meta
        title="Get Started"
        description="Tell us where you are headed. A partner will read your intake personally and respond within two business days."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-30" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Get Started
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Tell us where you are headed.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-2xl">
            A few questions so the right partner reads your note. No automation, no
            sales sequences — a real reply within two business days.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
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
                <h2 className="text-3xl font-bold mb-4">We have your brief.</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  A partner will read it personally and reply within two business
                  days. Thank you for thinking of Synozur.
                </p>
              </div>
            </motion.div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="rounded-2xl border border-border/60 bg-card p-8 md:p-10 space-y-10"
            >
              <fieldset className="space-y-6">
                <legend className="text-xs uppercase tracking-widest text-primary mb-4">
                  About you
                </legend>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" {...register("name")} />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Input id="role" {...register("role")} />
                    {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input id="company" {...register("company")} />
                    {errors.company && <p className="text-sm text-destructive">{errors.company.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Work email</Label>
                    <Input id="email" type="email" {...register("email")} />
                    {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-xs uppercase tracking-widest text-primary mb-2">
                  The work
                </legend>
                <div className="space-y-2">
                  <Label htmlFor="pillar">Closest service pillar</Label>
                  <select
                    id="pillar"
                    {...register("pillar")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {pillars.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="timeline">Timeline</Label>
                    <select
                      id="timeline"
                      {...register("timeline")}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {timelines.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="budget">Investment range</Label>
                    <select
                      id="budget"
                      {...register("budget")}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {budgets.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brief">Brief</Label>
                  <Textarea
                    id="brief"
                    rows={7}
                    placeholder="The situation, what good looks like in twelve months, and where you have tried things that have not landed."
                    {...register("brief")}
                  />
                  {errors.brief && <p className="text-sm text-destructive">{errors.brief.message}</p>}
                </div>
              </fieldset>

              <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
                {isSubmitting ? "Sending..." : (
                  <>Send brief <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
