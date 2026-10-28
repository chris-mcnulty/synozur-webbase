import { Search, Moon, Grip, ChevronDown, Newspaper, Mic, MonitorPlay, Wrench, Boxes, CalendarDays, FileText, Library } from "lucide-react";

/**
 * Proposed: thin right-aligned utility strip (Search · theme · Sign in) above
 * the main bar; single persistent nav row (secondary merged in, Insights+Events
 * folded into a Resources hub with dropdown + hub page); Book stays top-right.
 */

const NAV = ["Home", "The Sprint", "Proof", "Fit", "Method", "About"];

const HUB = [
  { icon: Newspaper, label: "Insights", desc: "Articles & white papers" },
  { icon: CalendarDays, label: "Events", desc: "Upcoming & past" },
  { icon: Mic, label: "Polaris Podcast", desc: "Episodes & shownotes" },
  { icon: MonitorPlay, label: "Webinars", desc: "On-demand sessions" },
  { icon: Wrench, label: "Workshops", desc: "Hands-on programs" },
  { icon: Boxes, label: "Models", desc: "Frameworks & tools" },
  { icon: FileText, label: "Case Studies", desc: "Client outcomes" },
  { icon: Library, label: "Browse Library", desc: "Everything, filterable" },
];

function Logo({ dark = true }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className={`p-1.5 rounded-md ${dark ? "text-white/60" : "text-zinc-500"}`}><Grip className="h-4 w-4" /></span>
      <span className="flex items-center gap-1.5">
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-[#810FFB] to-[#3aa0ff]" />
        <span className={`font-bold tracking-tight text-lg ${dark ? "text-white" : "text-zinc-900"}`}>synozur</span>
      </span>
    </div>
  );
}

function UtilityStrip({ dark }: { dark: boolean }) {
  const t = dark ? "text-white/60 hover:text-white" : "text-zinc-500 hover:text-zinc-900";
  return (
    <div className={`${dark ? "border-white/10" : "border-zinc-200"} border-b`}>
      <div className="mx-auto px-6 h-8 flex items-center justify-end gap-4">
        <button className={`inline-flex items-center gap-1.5 text-xs ${t}`}>
          <Search className="h-3.5 w-3.5" /> Search
          <kbd className={`inline-flex h-4 items-center rounded border px-1 font-mono text-[9px] ${dark ? "border-white/15 text-white/40" : "border-zinc-300 text-zinc-400"}`}>⌘K</kbd>
        </button>
        <span className={t}><Moon className="h-3.5 w-3.5" /></span>
        <a href="#" className={`text-xs font-medium ${t}`}>Sign in</a>
      </div>
    </div>
  );
}

function MainBar({ dark, resourcesOpen = false }: { dark: boolean; resourcesOpen?: boolean }) {
  return (
    <div className="relative">
      <div className="mx-auto px-6 h-14 flex items-center gap-3">
        <Logo dark={dark} />
        <nav className="flex items-center gap-1 flex-1 justify-center">
          {NAV.map((n, i) => (
            <a key={n} href="#" className={`px-3.5 py-2 rounded-md text-sm font-semibold ${i === 0 ? "text-[#a05cff] bg-[#810FFB]/10" : dark ? "text-white/75 hover:text-white" : "text-zinc-600 hover:text-zinc-900"}`}>{n}</a>
          ))}
          <a href="#" className={`px-3.5 py-2 rounded-md text-sm font-semibold inline-flex items-center gap-1 ${resourcesOpen ? (dark ? "text-white bg-white/10" : "text-zinc-900 bg-zinc-100") : dark ? "text-white/75 hover:text-white" : "text-zinc-600 hover:text-zinc-900"}`}>
            Resources <ChevronDown className="h-3.5 w-3.5" />
          </a>
        </nav>
        <a href="#" className="h-9 px-5 inline-flex items-center rounded-md bg-[#810FFB] text-white text-sm font-semibold shadow-[0_0_16px_rgba(129,15,251,0.35)]">Book</a>
      </div>
      {resourcesOpen && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 w-[620px] rounded-xl border shadow-2xl z-10 p-4 grid grid-cols-2 gap-1 ${dark ? "bg-[#14142a] border-white/10" : "bg-white border-zinc-200"}`}>
          {HUB.map(({ icon: Icon, label, desc }) => (
            <a key={label} href="#" className={`flex items-start gap-3 rounded-lg p-2.5 ${dark ? "hover:bg-white/5" : "hover:bg-zinc-50"}`}>
              <Icon className={`h-4 w-4 mt-0.5 ${dark ? "text-[#a05cff]" : "text-[#810FFB]"}`} />
              <span>
                <span className={`block text-sm font-medium ${dark ? "text-white/90" : "text-zinc-900"}`}>{label}</span>
                <span className={`block text-xs ${dark ? "text-white/40" : "text-zinc-500"}`}>{desc}</span>
              </span>
            </a>
          ))}
          <a href="#" className={`col-span-2 mt-1 pt-2.5 border-t text-center text-xs font-semibold ${dark ? "border-white/10 text-[#a05cff]" : "border-zinc-200 text-[#810FFB]"}`}>
            Visit the Resources hub →
          </a>
        </div>
      )}
    </div>
  );
}

export function Proposed() {
  return (
    <div className="min-h-screen bg-zinc-950 p-8 space-y-8">
      <div>
        <p className="text-white/50 text-xs uppercase tracking-widest mb-2">Proposed — top of page (Resources dropdown open)</p>
        <div className="bg-[#0B0B1A] pb-64 rounded-lg overflow-visible relative">
          <UtilityStrip dark />
          <MainBar dark resourcesOpen />
        </div>
      </div>
      <div>
        <p className="text-white/50 text-xs uppercase tracking-widest mb-2">Proposed — after scrolling (utility strip collapses, nav stays complete)</p>
        <div className="bg-zinc-100 pb-14 rounded-lg overflow-hidden">
          <div className="bg-white/95 border-b border-zinc-200 shadow-md">
            <MainBar dark={false} />
          </div>
          <div className="px-10 pt-6">
            <p className="text-emerald-600 text-xs font-semibold">✓ Every section stays reachable while scrolling — nothing disappears</p>
          </div>
        </div>
      </div>
      <ul className="text-white/40 text-xs space-y-1 list-disc pl-4">
        <li>Utility strip (top-right): Search · theme · Sign in — separate quiet tier</li>
        <li>One nav row: Home · The Sprint · Proof · Fit · Method · About · Resources ▾ + Book CTA</li>
        <li>Resources = dropdown for quick access + a full hub landing page</li>
        <li>On scroll only the 32px utility strip collapses; the full nav persists</li>
      </ul>
    </div>
  );
}
