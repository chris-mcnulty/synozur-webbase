import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight,
  Star,
  Eye,
  Users,
  LayoutGrid,
  TrendingUp,
  RefreshCw,
  Shield,
  HeartHandshake,
  Fingerprint,
  Lightbulb,
  Rocket,
  Award,
} from "lucide-react";

const approach = [
  {
    icon: Eye,
    title: "Targeted Evaluations",
    body: "We blend qualitative interviews with data analysis to develop a holistic view of your business.",
  },
  {
    icon: LayoutGrid,
    title: "Collective Thinking",
    body: "Workshops, planning, and design-led thinking to form new strategies for your organization.",
  },
  {
    icon: TrendingUp,
    title: "Strategy & Execution",
    body: "Our proprietary management frameworks for distributing and developing strategic outcomes help you achieve elevated success.",
  },
  {
    icon: RefreshCw,
    title: "Continuous Support",
    body: "We provide ongoing engagement throughout your journey to ensure excellence.",
  },
];

const values = [
  {
    icon: Shield,
    title: "Ethical",
    body: "We have an unwavering commitment to operating with the highest ethical standards in all our actions and decisions — ensuring fairness and respect.",
  },
  {
    icon: Users,
    title: "Inclusive",
    body: "We provide a sense of wellbeing, belonging, and community to our employees, our customers, and the communities we serve.",
  },
  {
    icon: HeartHandshake,
    title: "Honesty & Integrity",
    body: "We live by our word, and we will always do the right thing, even when it's hard.",
  },
  {
    icon: Fingerprint,
    title: "Human-Centric",
    body: "Success lies in understanding and prioritizing the needs, aspirations, and well-being of the people involved. Our approach is rooted in empathy, active listening, and genuine collaboration.",
  },
  {
    icon: Rocket,
    title: "Entrepreneurial",
    body: "We embody the entrepreneurial spirit in everything we do.",
  },
  {
    icon: Award,
    title: "Excellence",
    body: "Quality over speed. High standards and continuous improvement. Client satisfaction delivered with the highest level of professionalism and care.",
  },
];

export default function About() {
  return (
    <div className="w-full">
      <Meta
        title="Our Story"
        description="Synozur, named for the North Star, guides organizations through the complexities of strategic transformation with decades of global advisory experience."
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-30" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-sm uppercase tracking-widest text-primary mb-4"
          >
            Our Story
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8"
          >
            Transforming business through{" "}
            <span className="nebula-text">culture and innovation</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="text-xl md:text-2xl text-zinc-300 leading-relaxed"
          >
            Our empathetic approach is tailored to your unique journey,
            navigating the complexities of transformation with ease. We have
            decades of experience delivering global strategic advisory services
            that elevate you to achieve breakthrough innovation.
          </motion.p>
        </div>
      </section>

      {/* Our Mission */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-4"
          >
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Our Mission
            </p>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">
              Named for the North Star
            </h2>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="lg:col-span-8 space-y-6 text-lg text-muted-foreground leading-relaxed"
          >
            <p>
              Synozur, a name inspired by the ancient Greek term for the North
              Star, symbolizes our unwavering commitment to guiding you to
              success.
            </p>
            <p>
              Just as the North Star has been a beacon of navigation for
              centuries, Synozur stands as the central point of orientation in
              the business landscape — steering you towards your desired
              outcomes with precision and clarity.
            </p>
            <p className="text-foreground font-medium">
              Our name reflects our mission: we navigate organizations through
              the complexities of strategic transformation with ease.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Find Your North Star */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-8">
              <Star className="h-7 w-7" />
            </div>
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              What we do
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
              Find Your North Star
            </h2>
            <div className="space-y-5 text-lg text-muted-foreground leading-relaxed">
              <p>
                We are your navigators of change. Transforming and planning new
                management and operating strategies is the core of each
                engagement.
              </p>
              <p>
                Our team is specifically assembled to assess and understand your
                organizational challenges.
              </p>
              <p>
                We'll help you plot a new direction — a new North Star for your
                business. We'll discover what is desirable for your employees
                and customers alike. Then we'll help outline strategies and an
                executable roadmap to make it achievable.
              </p>
            </div>
          </motion.div>

          {/* Approach card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="space-y-5"
          >
            <p className="text-sm uppercase tracking-widest text-primary mb-6">
              Our Approach
            </p>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
              We don't believe in one-size-fits-all solutions. Your journey is
              unique, and our empathetic approach reflects that. We listen,
              understand, and tailor our strategies to your specific needs.
            </p>
            <p className="text-base font-semibold text-foreground mb-4">
              Key elements of our engagement:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {approach.map((item, i) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.15 + i * 0.07 }}
                  className="rounded-xl border border-border/60 bg-background/50 p-5 hover:border-primary/40 transition-colors"
                >
                  <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <h4 className="font-semibold mb-1">{item.title}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.body}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-16">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Our Values
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Living our values through client commitments
            </h2>
            <p className="text-lg text-muted-foreground">
              We pride ourselves on living our values through every client
              commitment — holding ourselves to these standards in all we do.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {values.map((v, i) => (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
                className="rounded-xl border border-border/60 bg-card p-8 hover:border-primary/40 transition-colors"
              >
                <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
                  <v.icon className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold mb-3">{v.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{v.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-card border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Meet the people behind the firm
          </h2>
          <p className="text-lg text-muted-foreground mb-10">
            Our partners have led transformation at some of the most
            recognizable organizations in the world. Now they bring that
            experience to yours.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/team"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Meet the team <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-8 text-base font-medium text-foreground transition-colors hover:bg-muted"
            >
              Talk with us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
