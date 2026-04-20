import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Compass, Layers, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { caseStudies } from "@/data/case-studies";

export default function Home() {
  return (
    <div className="w-full">
      <Meta 
        title="The Transformation Company" 
        description="The Synozur Alliance is a strategic advisory and transformation consultancy guiding organizations to their North Star."
      />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-[#0B0B1A]">
        {/* Background Image / Nebula */}
        <div className="absolute inset-0 z-0 opacity-60">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
          <img 
            src="/images/hero-bg.png" 
            alt="Cosmic nebula background" 
            className="w-full h-full object-cover"
          />
        </div>
        
        <div className="container relative z-10 mx-auto px-4 py-24 md:py-32 flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-4xl"
          >
            <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/20 text-white text-sm font-medium mb-6 backdrop-blur-sm">
              The Synozur Alliance
            </span>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight text-white mb-8">
              The <span className="nebula-text">Transformation</span> Company
            </h1>
            <p className="text-xl md:text-2xl text-zinc-300 mb-10 max-w-3xl mx-auto leading-relaxed">
              We guide organizations to their North Star through transformation that is rooted in people, powered by technology, and driven by purpose.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/start" className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link href="/services-overview/default" className="inline-flex h-12 items-center justify-center rounded-md border border-white/20 bg-white/5 backdrop-blur-sm px-8 text-base font-medium text-white shadow-sm transition-colors hover:bg-white/10 hover:text-white">
                Explore Services
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Find Your North Star */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-6">Find Your North Star</h2>
              <div className="space-y-4 text-lg text-muted-foreground">
                <p>
                  In ancient times, navigators looked to Polaris—the North Star—to find their way across uncharted waters. Today, in an era of unprecedented disruption, organizations need a similarly steadfast point of reference.
                </p>
                <p>
                  At Synozur, we believe that successful transformation isn't just about implementing new technology. It's about aligning your people, processes, and tools toward a singular, purposeful destination.
                </p>
                <p>
                  Led by Fortune 500 veterans, we bring deep expertise and a proven methodology to help you navigate complexity, accelerate growth, and realize your strategic vision.
                </p>
              </div>
              <div className="mt-8">
                <Link href="/about" className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors">
                  Our Story <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-square rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-card"
            >
              <img
                src="/images/home-hero-editorial.png"
                alt="Editorial: leadership team in a modern conference room"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent z-10 opacity-30 mix-blend-overlay" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Featured Case Studies / From The Feed */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
            <div>
              <p className="text-sm uppercase tracking-widest text-primary mb-3">From The Feed</p>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Selected client work</h2>
              <p className="text-muted-foreground text-lg max-w-2xl">
                A small sample of the engagements we are able to share publicly — the strategies, the work, and the outcomes.
              </p>
            </div>
            <Link href="/case-studies" className="inline-flex items-center text-sm font-medium border border-border rounded-md px-4 py-2 hover:bg-muted transition-colors shrink-0">
              View All Case Studies <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {caseStudies.slice(0, 2).map((s) => (
              <Card key={s.slug} className="group overflow-hidden border-border/50 bg-background/50 hover:bg-background transition-colors hover:border-primary/30">
                <CardContent className="p-0">
                  <Link href={`/case-studies/${s.slug}`} className="block">
                    <div className="aspect-[2/1] relative overflow-hidden bg-muted">
                      <img
                        src={s.heroImage}
                        alt={s.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10" />
                      <div className="absolute bottom-6 left-6 right-6 z-20">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <span className="inline-block py-1 px-3 rounded-full bg-white/15 border border-white/25 text-white text-xs font-medium backdrop-blur-md">
                            {s.industry}
                          </span>
                          <span className="inline-block py-1 px-3 rounded-full bg-primary/30 border border-primary/40 text-white text-xs font-medium backdrop-blur-md">
                            Case Study
                          </span>
                        </div>
                        <h3 className="text-2xl font-bold text-white leading-tight">{s.title}</h3>
                      </div>
                    </div>
                    <div className="p-6">
                      <p className="text-sm font-semibold text-primary mb-3">{s.headline}</p>
                      <p className="text-muted-foreground mb-6 line-clamp-3">{s.summary}</p>
                      <span className="inline-flex items-center text-primary font-medium">
                        Read the case study <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Core Services / At a Glance */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 text-center max-w-3xl mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Built for Impact</h2>
          <p className="text-muted-foreground text-lg">
            We partner with visionary leaders to tackle their most complex challenges across four key pillars.
          </p>
        </div>

        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-border/50 bg-card hover-elevate">
              <CardContent className="p-8">
                <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
                  <Compass className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold mb-3">Our Services</h3>
                <p className="text-muted-foreground mb-6 line-clamp-3">
                  From Strategic Transformation to Go-to-Market execution, our comprehensive service pillars are designed to deliver measurable, sustainable results.
                </p>
                <Link href="/services-overview/default" className="inline-flex items-center text-sm font-medium hover:text-primary transition-colors">
                  View All Services <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card hover-elevate">
              <CardContent className="p-8">
                <div className="h-12 w-12 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center mb-6">
                  <Layers className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold mb-3">Our Projects</h3>
                <p className="text-muted-foreground mb-6 line-clamp-3">
                  Explore how we've helped Fortune 500 enterprises and hyper-growth companies navigate complex transformations and achieve their strategic goals.
                </p>
                <Link href="/case-studies" className="inline-flex items-center text-sm font-medium hover:text-primary transition-colors">
                  Read Case Studies <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card hover-elevate">
              <CardContent className="p-8">
                <div className="h-12 w-12 rounded-lg bg-[#3b82f6]/10 text-[#3b82f6] flex items-center justify-center mb-6">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold mb-3">Our Clients</h3>
                <p className="text-muted-foreground mb-6 line-clamp-3">
                  We are trusted by industry leaders to guide them through critical inflection points. Join the alliance of forward-thinking organizations.
                </p>
                <Link href="/clients" className="inline-flex items-center text-sm font-medium hover:text-primary transition-colors">
                  Meet Our Clients <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Band */}
      <section className="py-24 relative overflow-hidden bg-card border-t border-border">
        <div className="absolute inset-0 nebula-gradient opacity-10 z-0" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-3xl">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Ready to find your North Star?</h2>
          <p className="text-xl text-muted-foreground mb-10">
            Connect with our leadership team to discuss your transformation objectives and explore how Synozur can accelerate your journey.
          </p>
          <Link href="/start" className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
            Start the Conversation
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
