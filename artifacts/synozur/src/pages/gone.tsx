import { useEffect } from "react";
import { Link } from "wouter";
import { Archive } from "lucide-react";
import { Meta } from "@/lib/meta";

/**
 * Friendly "this content is no longer available" page (#162 / L13).
 *
 * Rendered by detail pages when the API returns HTTP 410 Gone — a row
 * that was once published but has since been archived or unpublished.
 * Distinct from <NotFound /> because the URL was once valid: we tell
 * the visitor the piece has been retired and steer them toward the
 * latest in that section instead of suggesting they mistyped.
 *
 * The HTTP status code is set on the SPA server (artifacts/synozur/server.mjs)
 * — this component only owns the visible UX.
 */

interface GoneProps {
  /** Section index to link back to, e.g. "/insights" or "/case-studies". */
  backHref?: string;
  /** Visible label for the back link. */
  backLabel?: string;
}

export default function Gone({
  backHref = "/",
  backLabel = "Return home",
}: GoneProps) {
  useEffect(() => {
    // No traffic beacon: 410 is intentional, not a missing page.
  }, []);

  return (
    <div className="relative w-full min-h-[80vh] flex items-center justify-center overflow-hidden bg-[#0B0B1A]">
      <Meta
        title="No longer available"
        description="This content has been retired."
        pageType="not-found"
      />
      <div className="absolute inset-0 nebula-gradient opacity-25" />
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 70% 60%, white, transparent), radial-gradient(1px 1px at 40% 80%, white, transparent), radial-gradient(2px 2px at 85% 20%, white, transparent), radial-gradient(1px 1px at 10% 70%, white, transparent), radial-gradient(1px 1px at 55% 15%, white, transparent)",
          backgroundSize: "100% 100%",
        }}
      />
      <div className="relative z-10 text-center max-w-xl px-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-white/10 border border-white/20 text-white flex items-center justify-center mb-8 backdrop-blur">
          <Archive className="h-7 w-7" />
        </div>
        <p className="text-sm uppercase tracking-widest text-primary mb-4">
          410 — retired from the constellation
        </p>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white mb-6">
          This piece has been retired.
        </h1>
        <p className="text-lg text-zinc-300 mb-10">
          The content at this address has been unpublished. It may have been
          superseded by something newer — explore the latest below.
        </p>
        <Link
          href={backHref}
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
