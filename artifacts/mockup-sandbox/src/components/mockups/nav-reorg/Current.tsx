import { Search, Menu, Moon, Grip } from "lucide-react";

/** Baseline: current B-chrome header, shown in both scroll states. */

const PRIMARY = ["Home", "The Sprint", "Proof", "Fit"];
const SECONDARY = ["About", "Method", "Insights", "Events"];

function Logo({ dark = true }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className={`p-1.5 rounded-md ${dark ? "text-white/60 hover:bg-white/10" : "text-zinc-500"}`}><Grip className="h-4 w-4" /></span>
      <span className="flex items-center gap-1.5">
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-[#810FFB] to-[#3aa0ff]" />
        <span className={`font-bold tracking-tight text-lg ${dark ? "text-white" : "text-zinc-900"}`}>synozur</span>
      </span>
    </div>
  );
}

function SearchBtn({ dark }: { dark: boolean }) {
  return (
    <button className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${dark ? "border-white/20 bg-white/5 text-white/80" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}>
      <Search className="h-4 w-4" /> Search…
      <kbd className={`inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px] ${dark ? "border-white/15 bg-white/5 text-white/50" : "border-zinc-200 bg-zinc-100 text-zinc-400"}`}>⌘K</kbd>
    </button>
  );
}

function HeaderTop() {
  return (
    <div className="bg-[#0B0B1A] pb-20 rounded-lg overflow-hidden">
      <div className="border-b border-transparent">
        <div className="mx-auto px-6 h-16 flex items-center gap-3">
          <Logo dark />
          <nav className="flex items-center gap-1 flex-1 justify-center">
            {PRIMARY.map((n, i) => (
              <a key={n} href="#" className={`px-4 py-2 rounded-md text-sm font-semibold ${i === 0 ? "text-[#a05cff] bg-[#810FFB]/10" : "text-white/75 hover:text-white"}`}>{n}</a>
            ))}
            <a href="#" className="ml-2 h-9 px-5 inline-flex items-center rounded-md bg-[#810FFB] text-white text-sm font-semibold shadow-[0_0_16px_rgba(129,15,251,0.35)]">Book</a>
          </nav>
          <div className="flex items-center gap-1.5">
            <SearchBtn dark />
            <span className="p-2 text-white/60"><Moon className="h-4 w-4" /></span>
            <a href="#" className="inline-flex h-9 items-center rounded-md border border-white/20 bg-white/5 px-4 text-sm font-medium text-white/80">Sign in</a>
          </div>
        </div>
        {/* Secondary sub-bar — only visible while unscrolled */}
        <div className="border-t border-white/10">
          <div className="mx-auto px-6 h-9 flex items-center justify-center gap-8">
            {SECONDARY.map(n => (
              <a key={n} href="#" className="text-xs font-medium tracking-wide text-white/50 hover:text-white/80">{n}</a>
            ))}
          </div>
        </div>
      </div>
      <div className="px-10 pt-10">
        <p className="text-white/30 text-xs uppercase tracking-widest">dark hero area…</p>
      </div>
    </div>
  );
}

function HeaderScrolled() {
  return (
    <div className="bg-zinc-100 pb-16 rounded-lg overflow-hidden">
      <div className="bg-white/95 border-b border-zinc-200 shadow-md">
        <div className="mx-auto px-6 h-16 flex items-center gap-3">
          <Logo dark={false} />
          <nav className="flex items-center gap-1 flex-1 justify-center">
            {PRIMARY.map(n => (
              <a key={n} href="#" className="px-4 py-2 rounded-md text-sm font-semibold text-zinc-600 hover:text-zinc-900">{n}</a>
            ))}
            <a href="#" className="ml-2 h-9 px-5 inline-flex items-center rounded-md bg-[#810FFB] text-white text-sm font-semibold shadow-[0_0_16px_rgba(129,15,251,0.35)]">Book</a>
          </nav>
          <div className="flex items-center gap-1.5">
            <SearchBtn dark={false} />
            <span className="p-2 text-zinc-500"><Moon className="h-4 w-4" /></span>
            <a href="#" className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-600">Sign in</a>
          </div>
        </div>
        {/* Secondary bar is GONE when scrolled */}
      </div>
      <div className="px-10 pt-8">
        <p className="text-red-500/80 text-xs font-semibold">⚠ About · Method · Insights · Events are no longer reachable from the header once the page scrolls</p>
      </div>
    </div>
  );
}

export function Current() {
  return (
    <div className="min-h-screen bg-zinc-950 p-8 space-y-8">
      <div>
        <p className="text-white/50 text-xs uppercase tracking-widest mb-2">Current — top of page</p>
        <HeaderTop />
      </div>
      <div>
        <p className="text-white/50 text-xs uppercase tracking-widest mb-2">Current — after scrolling</p>
        <HeaderScrolled />
      </div>
      <ul className="text-white/40 text-xs space-y-1 list-disc pl-4">
        <li>Two nav rows at top; second row disappears on scroll (inconsistent)</li>
        <li>Search / Sign in mixed into the same row as nav + Book (no utility tier)</li>
        <li>Insights, Events, Podcast, Webinars, Workshops, Models scattered — no hub</li>
      </ul>
    </div>
  );
}
