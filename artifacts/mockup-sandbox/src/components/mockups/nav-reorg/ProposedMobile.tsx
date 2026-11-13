import { Search, X, Grip, ChevronDown } from "lucide-react";

/** Proposed mobile drawer: search, primary nav, Book CTA, Resources group, utility row. */

export function ProposedMobile() {
  return (
    <div className="min-h-screen bg-[#0B0B1A]">
      {/* Header bar */}
      <div className="border-b border-white/10">
        <div className="px-4 h-8 flex items-center justify-end gap-4">
          <a href="#" className="text-[11px] font-medium text-white/60">Sign in</a>
        </div>
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white/60"><Grip className="h-4 w-4" /></span>
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[#810FFB] to-[#3aa0ff]" />
            <span className="font-bold tracking-tight text-white">synozur</span>
          </div>
          <button className="p-2 text-white/80"><X size={22} /></button>
        </div>
      </div>

      {/* Drawer */}
      <div className="px-4 py-4 space-y-1 bg-[#0e0e20]/95">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input placeholder="Search…" className="w-full h-10 pl-9 pr-4 rounded-md border border-white/15 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none" />
        </div>

        {["Home", "The Sprint", "Proof", "Fit", "Method", "About"].map((n, i) => (
          <a key={n} href="#" className={`block px-3 py-2.5 rounded-md text-sm font-semibold ${i === 0 ? "text-[#a05cff] bg-[#810FFB]/10" : "text-white/80"}`}>{n}</a>
        ))}

        <a href="#" className="block px-3 py-2.5 rounded-md text-sm font-semibold text-center bg-[#810FFB] text-white shadow-[0_0_16px_rgba(129,15,251,0.35)]">Book the Sprint</a>

        <div className="pt-3 mt-3 border-t border-white/10">
          <button className="w-full flex items-center justify-between px-3 py-2">
            <span className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">Resources</span>
            <ChevronDown className="h-3.5 w-3.5 text-white/40" />
          </button>
          <div className="grid grid-cols-2 gap-x-2">
            {["Insights", "Events", "Podcast", "Webinars", "Workshops", "Models", "Case Studies", "Library"].map(n => (
              <a key={n} href="#" className="block px-3 py-2 rounded-md text-sm text-white/55">{n}</a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
