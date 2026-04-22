import { Card } from "@/components/ui/card";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  Search,
  Image as ImageIcon,
  Share2,
  Tag,
  ShieldCheck,
  Map,
  Building2,
} from "lucide-react";

interface PlannedItem {
  title: string;
  description: string;
  icon: typeof Search;
}

const PLANNED: PlannedItem[] = [
  {
    icon: Search,
    title: "Default title & meta description",
    description:
      "Site-wide title template (e.g. `{page} | The Synozur Alliance`) and fallback description used when a page doesn't supply its own.",
  },
  {
    icon: ImageIcon,
    title: "Default Open Graph image",
    description:
      "Fallback OG / Twitter card image used on pages that don't set one. Uploaded through the same asset flow as the home hero images.",
  },
  {
    icon: Share2,
    title: "Social handles & card defaults",
    description:
      "Twitter @-handle, default card type (summary vs. summary_large_image), and LinkedIn company page — threaded into meta tags automatically.",
  },
  {
    icon: Tag,
    title: "Analytics & marketing tag IDs",
    description:
      "GA4, LinkedIn Insight Partner, Meta Pixel. Today these are environment variables (VITE_GA4_ID etc.); this section will make them editable without a redeploy, while keeping the cookie-consent gate.",
  },
  {
    icon: ShieldCheck,
    title: "Search engine verification",
    description:
      "Google Search Console and Bing Webmaster verification meta tags.",
  },
  {
    icon: Map,
    title: "Sitemap settings",
    description:
      "Which sections appear in /sitemap.xml, how often it regenerates, and manual exclusion of specific URLs.",
  },
  {
    icon: Building2,
    title: "Organization structured data",
    description:
      "Editable fields behind the Organization JSON-LD currently rendered by `organization-jsonld.tsx` (legal name, logo, sameAs links).",
  },
];

export default function MarketingSeo() {
  return (
    <AdminLayout
      title="SEO"
      crumbs={[{ label: "Admin", href: "/" }, { label: "Marketing" }, { label: "SEO" }]}
    >
      <Card className="p-5 mb-5 bg-muted/30">
        <p className="text-sm">
          SEO configuration will live here. Today, SEO defaults are split between{" "}
          <code className="text-xs bg-background px-1 py-0.5 rounded">seo-config.ts</code>,{" "}
          <code className="text-xs bg-background px-1 py-0.5 rounded">meta.tsx</code>, and{" "}
          environment variables. This page will consolidate them into a database-backed
          settings surface so marketing can adjust tags, descriptions, and tag-manager IDs
          without a redeploy.
        </p>
      </Card>

      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Planned controls
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PLANNED.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="p-5">
              <div className="flex items-start gap-3">
                <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-sm">{item.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {item.description}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </AdminLayout>
  );
}
