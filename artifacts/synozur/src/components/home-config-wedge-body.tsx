// HomeConfigWedge body — a small floating chip + popover-style modal
// that lists the admin pages relevant to homepage configuration. The
// home page composes from `site_settings`, `publish_blocks` (carousel),
// experiments, and featured collateral — there's no single entity to
// PATCH inline, so this surface is navigation-only.
//
// Default-exported so `React.lazy(() => import(...))` works without a
// named-export shim, matching the EditWedge body's contract.
import { useEffect, useState } from "react";
import {
  ExternalLink,
  Settings,
  X,
  Image as ImageIcon,
  FlaskConical,
  Layers,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface ConfigDestination {
  href: string;
  label: string;
  description: string;
  icon: typeof Settings;
}

const DESTINATIONS: readonly ConfigDestination[] = [
  {
    href: "/admin/site-config/site-settings",
    label: "Site settings",
    description: "Hero image, theme, default OG image, branding, SEO defaults",
    icon: Settings,
  },
  {
    href: "/admin/site-config/alt-home",
    label: "Alt home",
    description: "Home B variant copy and content",
    icon: Layers,
  },
  {
    href: "/admin/library/carousel",
    label: "Featured carousel",
    description: "Items shown in the home page carousel rail",
    icon: ImageIcon,
  },
  {
    href: "/admin/site-config/experiments",
    label: "Experiments",
    description: "A/B variants currently running on the home page",
    icon: FlaskConical,
  },
];

export default function HomeConfigWedgeBody() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FloatingChip onClick={() => setOpen(true)} />
      {open && <ConfigModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FloatingChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Configure home page"
      data-testid="home-config-wedge-chip"
      className={cn(
        "fixed bottom-6 right-6 z-40",
        "flex items-center gap-2 px-3 py-2 rounded-full",
        // Distinct accent so editors can tell at a glance this is a
        // navigation chip, not the inline-edit wedge used on detail
        // pages — secondary palette + cog icon vs. primary + pencil.
        "bg-secondary text-secondary-foreground border border-border shadow-lg",
        "text-sm font-medium",
        "opacity-70 hover:opacity-100 focus-visible:opacity-100",
        "transition-opacity",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <Settings className="h-4 w-4" aria-hidden="true" />
      <span>Configure</span>
    </button>
  );
}

function ConfigModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure home</DialogTitle>
          <DialogDescription>
            The home page composes content from several sources. Pick the
            surface you want to edit; it&apos;ll open in a new tab so you
            can keep this page open for reference.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            return (
              <li key={d.href}>
                <button
                  type="button"
                  onClick={() => {
                    window.open(`${BASE_PATH}${d.href}`, "_blank", "noopener");
                    onClose();
                  }}
                  className={cn(
                    "w-full text-left rounded-md border border-border p-3",
                    "flex items-start gap-3",
                    "hover:bg-muted/50 focus-visible:bg-muted/50",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  data-testid={`home-config-wedge-${d.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{d.label}</span>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {d.description}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-2" aria-hidden="true" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
