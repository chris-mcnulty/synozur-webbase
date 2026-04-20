import { Link } from "wouter";
import { ArrowRight, Linkedin, Twitter, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Footer() {
  return (
    <footer className="bg-card border-t border-border pt-16 pb-8">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Find Your North Star</h2>
          <p className="text-muted-foreground text-lg">
            Let us guide your organization's transformation journey. Rooted in people, powered by technology, and driven by purpose.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8 mb-16">
          <div className="lg:col-span-2">
            <h3 className="font-semibold mb-4 text-foreground">Subscribe to The Feed</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Get the latest insights, models, and episodes of Polaris delivered to your inbox.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
              }}
              aria-label="Subscribe to The Feed"
            >
              <label htmlFor="footer-subscribe-email" className="sr-only">
                Email address
              </label>
              <Input
                id="footer-subscribe-email"
                type="email"
                placeholder="Email address"
                className="max-w-[240px]"
              />
              <Button type="submit">Subscribe</Button>
            </form>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Services</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/services/strategic-transformation" className="hover:text-primary transition-colors">Strategic Transformation</Link></li>
              <li><Link href="/services/technology-transformation" className="hover:text-primary transition-colors">Technology Transformation</Link></li>
              <li><Link href="/services/experiences" className="hover:text-primary transition-colors">Experiences</Link></li>
              <li><Link href="/services/go-to-market-transformation" className="hover:text-primary transition-colors">Go-to-Market Transformation</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Applications</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/applications" className="hover:text-primary transition-colors">All Applications</Link></li>
              <li><Link href="/applications/vega" className="hover:text-primary transition-colors">Vega</Link></li>
              <li><Link href="/applications/nebula" className="hover:text-primary transition-colors">Nebula</Link></li>
              <li><Link href="/applications/orion" className="hover:text-primary transition-colors">Orion (Models)</Link></li>
              <li><Link href="/applications/zenith" className="hover:text-primary transition-colors">Zenith</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Company</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/about" className="hover:text-primary transition-colors">Our Story</Link></li>
              <li><Link href="/team" className="hover:text-primary transition-colors">Leadership</Link></li>
              <li><Link href="/partners" className="hover:text-primary transition-colors">Partners</Link></li>
              <li><Link href="/clients" className="hover:text-primary transition-colors">Clients</Link></li>
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-foreground">Connect</h3>
            <div className="flex gap-4 mb-6">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors" aria-label="LinkedIn">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors" aria-label="Twitter">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors" aria-label="YouTube">
                <Youtube className="h-5 w-5" />
              </a>
            </div>
            <Link href="/start" className="inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
              Get Started <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} The Synozur Alliance. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/" className="hover:text-foreground transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
