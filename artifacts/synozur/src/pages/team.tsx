import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Linkedin } from "lucide-react";

type Person = {
  name: string;
  title: string;
  bio: string;
  image: string;
  linkedin: string;
};

const people: Person[] = [
  {
    name: "Michelle Caldwell",
    title: "Chief Executive Officer",
    bio: "A workplace experience leader with over 25 years delivering transformative solutions to diverse organizations powered by Ethical AI.",
    image: "/images/team-michelle-caldwell.png",
    linkedin: "https://www.linkedin.com/in/michellecaldwell/",
  },
  {
    name: "Matt Shaffer",
    title: "Organizational Design and Executive Coaching",
    bio: "Matt focuses on company-wide management consulting alongside C-level operational expertise.",
    image: "/images/team-matt-shaffer.png",
    linkedin: "https://www.linkedin.com/in/mattshaffer/",
  },
  {
    name: "Rob Asen",
    title: "Transformation Officer",
    bio: "Rob offers transformation program strategies, guidance, and implementation to address business and technology challenges.",
    image: "/images/team-rob-asen.png",
    linkedin: "https://www.linkedin.com/in/robasen/",
  },
  {
    name: "Chris McNulty",
    title: "Chief Technology Officer",
    bio: "Chris is a product, marketing and technology executive with product creation experience for generative AI, Copilot, and Microsoft 365.",
    image: "/images/team-chris-mcnulty.png",
    linkedin: "https://www.linkedin.com/in/cmcnulty",
  },
  {
    name: "Shari L. Oswald",
    title: "Learning Experience Officer",
    bio: "Developing dynamic, enthusiastic, and imaginative learning experiences aimed at addressing real business challenges.",
    image: "/images/team-shari-oswald.png",
    linkedin: "https://www.linkedin.com/in/shortcutshari/",
  },
  {
    name: "Eric Riz",
    title: "Organizational Governance & Operational Excellence",
    bio: "Eric's proficiency in Microsoft 365 and project management drives excellence in implementing changes that influence corporate strategies and efficiencies.",
    image: "/images/team-eric-riz.png",
    linkedin: "https://www.linkedin.com/in/ericriz/",
  },
  {
    name: "Michelle Boyd",
    title: "Head of Delivery Excellence",
    bio: "Michelle is a key driver of client success, renowned for delivering substantial business value and product and project benefits.",
    image: "/images/team-michelle-boyd.png",
    linkedin: "https://www.linkedin.com/in/michelleboyd01/",
  },
  {
    name: "Andrew Borg",
    title: "Ethical AI and Nonprofits",
    bio: "An Innovation Catalyst for AI ethics and Digital Transformation, Andrew is at the forefront of introducing positive disruptive experience and innovation culture to nonprofit organizations.",
    image: "/images/team-andrew-borg.png",
    linkedin: "https://www.linkedin.com/in/andrewborg",
  },
  {
    name: "Joshua Christensen",
    title: "Future of Work & Product Strategy Leader",
    bio: "Joshua is a Workplace Experience and Product Strategy leader focused on designing digital solutions that enhance how employees work, collaborate, and engage with technology.",
    image: "/images/team-joshua-christensen.png",
    linkedin: "https://www.linkedin.com/in/joshuachr/",
  },
];

export default function Team() {
  return (
    <div className="w-full">
      <Meta
        title="Our Team"
        description="The leaders behind The Synozur Alliance — partners drawn from across the Fortune 500."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Team
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Operators who became advisors.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            At Synozur, we specialize in guiding organizations toward success
            through tailored solutions that optimize performance and maximize
            growth. Our partners sit alongside your team — not above it.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            Team Members
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-12">Leadership</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {people.map((p, i) => (
              <motion.article
                key={p.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.05 }}
                className="group"
              >
                <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-card mb-5 border border-border/50">
                  <img
                    src={p.image}
                    alt={p.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                </div>
                <h3 className="text-lg font-bold leading-tight">{p.name}</h3>
                <p className="text-sm text-primary mb-3">{p.title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {p.bio}
                </p>
                <a
                  href={p.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                  aria-label={`${p.name} on LinkedIn`}
                >
                  <Linkedin className="h-4 w-4" /> LinkedIn
                </a>
              </motion.article>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-10 max-w-2xl">
            Editorial portraits shown. Replace with supplied headshots when available.
          </p>
        </div>
      </section>

      <section className="py-24 bg-card border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            We are hiring senior practitioners.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            If you are a former operator who wants to do consulting differently — small
            teams, senior work, real outcomes — we should talk.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Get in touch
          </Link>
        </div>
      </section>
    </div>
  );
}
