import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="relative w-full min-h-[80vh] flex items-center justify-center overflow-hidden bg-[#0B0B1A]">
      <Meta title="Lost in the constellation" description="The page you were looking for is not on the map." />
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
          <Compass className="h-7 w-7" />
        </div>
        <p className="text-sm uppercase tracking-widest text-primary mb-4">
          404 — off the map
        </p>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white mb-6">
          Lost in the constellation.
        </h1>
        <p className="text-lg text-zinc-300 mb-10">
          The page you were looking for is not on the chart. Let us guide you back
          to the North Star.
        </p>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Return home
        </Link>
      </div>
    </div>
  );
}
