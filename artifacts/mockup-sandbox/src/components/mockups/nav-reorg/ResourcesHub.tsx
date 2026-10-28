import { useMemo, useState } from "react";
import {
  Search, Moon, Grip, ChevronDown, Newspaper, Mic, MonitorPlay, Wrench,
  Boxes, CalendarDays, FileText, Library, ArrowRight, Clock, Play, Filter,
} from "lucide-react";

/**
 * ResourcesHub: the full Resources hub landing page implied by the Proposed
 * nav — dark B-chrome (#0B0B1A), purple #810FFB accents, filterable grid of
 * all eight resource types with a featured rail and upcoming events strip.
 */

const PURPLE = "#810FFB";
const LILAC = "#a05cff";

const NAV = ["Home", "The Sprint", "Proof", "Fit", "Method", "About"];

const TYPES = [
  { key: "All", icon: Library },
  { key: "Insights", icon: Newspaper },
  { key: "Events", icon: CalendarDays },
  { key: "Podcast", icon: Mic },
  { key: "Webinars", icon: MonitorPlay },
  { key: "Workshops", icon: Wrench },
  { key: "Models", icon: Boxes },
  { key: "Case Studies", icon: FileText },
  { key: "Library", icon: Library },
] as const;

type TypeKey = (typeof TYPES)[number]["key"];

const ICONS: Record<string, typeof Newspaper> = {
  Insights: Newspaper, Events: CalendarDays, Podcast: Mic, Webinars: MonitorPlay,
  Workshops: Wrench, Models: Boxes, "Case Studies": FileText, Library: Library,
};

const ITEMS: { type: Exclude<TypeKey, "All">; title: string; desc: string; meta: string; tag?: string }[] = [
  { type: "Insights", title: "Why 74% of AI pilots stall before rollout", desc: "The adoption gap isn't technical — it's operational. A field guide to closing it.", meta: "8 min read · Feb 2025", tag: "White paper" },
  { type: "Case Studies", title: "Meridian Health: 3,200 seats to Copilot in 11 weeks", desc: "How a regional health system moved from pilot fatigue to measured adoption.", meta: "Client outcome" },
  { type: "Podcast", title: "Polaris #42 — Governance without gatekeeping", desc: "With Dana Okafor, CIO of Halvorsen Group, on trust as an operating system.", meta: "38 min · Episode 42" },
  { type: "Webinars", title: "The 90-day Copilot value map", desc: "On-demand session: sequencing use cases so value shows up before fatigue does.", meta: "52 min · On-demand" },
  { type: "Models", title: "The Adoption Flywheel", desc: "Our four-stage framework for turning early wins into self-sustaining momentum.", meta: "Framework · v3.1" },
  { type: "Events", title: "Synozur Live: Seattle", desc: "A half-day working session on AI operating models. Limited to 60 seats.", meta: "Mar 18 · Seattle, WA", tag: "In person" },
  { type: "Workshops", title: "Prompt Ops for Legal Teams", desc: "Hands-on, two-session program. Bring your own matters; leave with playbooks.", meta: "2 × 3 hrs · Cohort-based" },
  { type: "Insights", title: "The quiet cost of shadow AI", desc: "What unsanctioned tools reveal about unmet needs — and how to answer them.", meta: "6 min read · Jan 2025" },
  { type: "Webinars", title: "Change management for skeptics", desc: "Why the loudest resisters become the best champions, with the data to prove it.", meta: "47 min · On-demand" },
  { type: "Podcast", title: "Polaris #41 — The end of the pilot era", desc: "Solo episode: why 'let's run a pilot' is often a way of saying no slowly.", meta: "29 min · Episode 41" },
  { type: "Models", title: "Signal / Noise readiness scan", desc: "A 20-question diagnostic that maps where your org actually is, not where the deck says.", meta: "Diagnostic tool" },
  { type: "Case Studies", title: "Ardent Logistics: docs chaos to answer engine", desc: "Turning 14 years of tribal knowledge into a governed, searchable source of truth.", meta: "Client outcome" },
  { type: "Library", title: "The Sprint reading pack", desc: "Every article, template, and checklist we hand clients on day one — in one place.", meta: "Collection · 23 items" },
  { type: "Events", title: "Roundtable: AI in professional services", desc: "Invite-only dinner conversation. Chatham House rules, no slides.", meta: "Apr 9 · Chicago, IL", tag: "Invite only" },
  { type: "Workshops", title: "Executive AI fluency intensive", desc: "One day for leadership teams: enough depth to lead, zero jargon.", meta: "1 day · Private" },
  { type: "Library", title: "Governance policy templates", desc: "Acceptable-use, data handling, and review-cadence templates ready to adapt.", meta: "Templates · 8 files" },
];

function Chrome() {
  return (
    <header className="border-b border-white/10">
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-6xl px-6 h-8 flex items-center justify-end gap-4">
          <button className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
            <Search className="h-3.5 w-3.5" /> Search
            <kbd className="inline-flex h-4 items-center rounded border border-white/15 px-1 font-mono text-[9px] text-white/40">⌘K</kbd>
          </button>
          <span className="text-white/60"><Moon className="h-3.5 w-3.5" /></span>
          <a href="#" className="text-xs font-medium text-white/60 hover:text-white">Sign in</a>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="p-1.5 rounded-md text-white/60"><Grip className="h-4 w-4" /></span>
          <span className="flex items-center gap-1.5">
            <span className="h-7 w-7 rounded-full bg-gradient-to-br from-[#810FFB] to-[#3aa0ff]" />
            <span className="font-bold tracking-tight text-lg text-white">synozur</span>
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV.map((n) => (
            <a key={n} href="#" className="px-3.5 py-2 rounded-md text-sm font-semibold text-white/75 hover:text-white">{n}</a>
          ))}
          <a href="#" className="px-3.5 py-2 rounded-md text-sm font-semibold inline-flex items-center gap-1 text-[#a05cff] bg-[#810FFB]/10">
            Resources <ChevronDown className="h-3.5 w-3.5" />
          </a>
        </nav>
        <a href="#" className="ml-auto md:ml-0 h-9 px-5 inline-flex items-center rounded-md bg-[#810FFB] text-white text-sm font-semibold shadow-[0_0_16px_rgba(129,15,251,0.35)]">Book</a>
      </div>
    </header>
  );
}

function TypeBadge({ type }: { type: string }) {
  const Icon = ICONS[type] ?? Library;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#810FFB]/12 border border-[#810FFB]/25 px-2.5 py-1 text-[11px] font-semibold text-[#c69bff]">
      <Icon className="h-3 w-3" /> {type}
    </span>
  );
}

export function ResourcesHub() {
  const [active, setActive] = useState<TypeKey>("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return ITEMS.filter((i) => {
      const typeOk = active === "All" || i.type === active;
      const q = query.trim().toLowerCase();
      const qOk = !q || (i.title + " " + i.desc).toLowerCase().includes(q);
      return typeOk && qOk;
    });
  }, [active, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: ITEMS.length };
    for (const i of ITEMS) c[i.type] = (c[i.type] ?? 0) + 1;
    return c;
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#0B0B1A] text-white" style={{ fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <Chrome />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[820px] rounded-full bg-[#810FFB]/18 blur-[120px]" />
        <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#a05cff] mb-4">Resources hub</p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight max-w-2xl leading-[1.08]">
            Everything we know,<br />
            <span className="bg-gradient-to-r from-[#a05cff] to-[#3aa0ff] bg-clip-text text-transparent">out in the open.</span>
          </h1>
          <p className="mt-4 max-w-xl text-white/55 text-base leading-relaxed">
            Frameworks, field notes, episodes, and working sessions from the Synozur team.
            No gate on the good stuff — filter to what you need.
          </p>
          <div className="mt-7 flex items-center gap-3 max-w-md">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3 h-11 focus-within:border-[#810FFB]/60">
              <Search className="h-4 w-4 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the library…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-white/35 outline-none"
              />
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/40"><Filter className="h-3.5 w-3.5" /> {filtered.length} results</span>
          </div>
        </div>
      </section>

      {/* Featured rail */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <div className="grid md:grid-cols-3 gap-4">
          <a href="#" className="md:col-span-2 group relative rounded-2xl border border-[#810FFB]/30 bg-gradient-to-br from-[#1a1033] to-[#12122a] p-7 overflow-hidden hover:border-[#810FFB]/60 transition-colors">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#810FFB]/20 blur-3xl" />
            <TypeBadge type="Insights" />
            <h2 className="mt-4 text-2xl font-bold tracking-tight max-w-md leading-snug">The 2025 State of AI Adoption in the Mid-Market</h2>
            <p className="mt-2 text-sm text-white/55 max-w-md">Our annual research report — 412 leaders surveyed on what's actually shipping, what stalled, and why.</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c69bff] group-hover:gap-2.5 transition-all">
              Read the report <ArrowRight className="h-4 w-4" />
            </span>
          </a>
          <a href="#" className="group rounded-2xl border border-white/10 bg-white/[0.04] p-7 hover:border-white/25 transition-colors flex flex-col">
            <TypeBadge type="Podcast" />
            <h3 className="mt-4 text-lg font-bold tracking-tight leading-snug">Polaris — new episode every other Tuesday</h3>
            <p className="mt-2 text-sm text-white/55 flex-1">Conversations with the people making AI stick inside real organizations.</p>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-white/85">
              <span className="h-8 w-8 rounded-full bg-[#810FFB] inline-flex items-center justify-center"><Play className="h-3.5 w-3.5 fill-white text-white ml-0.5" /></span>
              Latest: Episode 42
            </span>
          </a>
        </div>
      </section>

      {/* Filter bar */}
      <div className="sticky top-0 z-20 border-y border-white/10 bg-[#0B0B1A]/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-2 overflow-x-auto">
          {TYPES.map(({ key, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 h-8 text-xs font-semibold border transition-colors ${
                  on
                    ? "bg-[#810FFB] border-[#810FFB] text-white shadow-[0_0_14px_rgba(129,15,251,0.35)]"
                    : "border-white/12 text-white/60 hover:text-white hover:border-white/30"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {key}
                <span className={`text-[10px] ${on ? "text-white/70" : "text-white/35"}`}>{counts[key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 py-20 text-center">
            <Library className="h-8 w-8 mx-auto text-white/25" />
            <p className="mt-3 text-sm font-semibold text-white/70">Nothing matches that filter.</p>
            <p className="mt-1 text-xs text-white/40">Try clearing the search or switching category.</p>
            <button onClick={() => { setQuery(""); setActive("All"); }} className="mt-4 text-xs font-semibold text-[#a05cff] hover:text-[#c69bff]">Reset filters</button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((item) => (
              <a key={item.title} href="#" className="group rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-[#810FFB]/50 hover:bg-[#810FFB]/[0.06] transition-colors flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <TypeBadge type={item.type} />
                  {item.tag && <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">{item.tag}</span>}
                </div>
                <h3 className="mt-3.5 text-[15px] font-bold leading-snug tracking-tight group-hover:text-[#d9bcff] transition-colors">{item.title}</h3>
                <p className="mt-1.5 text-[13px] text-white/50 leading-relaxed flex-1">{item.desc}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-white/40">
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" /> {item.meta}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-white/25 group-hover:text-[#a05cff] group-hover:translate-x-0.5 transition-all" />
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Newsletter footer band */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-14 flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1">
            <h2 className="text-xl font-bold tracking-tight">The Signal — one email, twice a month.</h2>
            <p className="mt-1.5 text-sm text-white/50 max-w-md">New resources, upcoming events, and one idea worth stealing. No filler, unsubscribe anytime.</p>
          </div>
          <form className="flex w-full md:w-auto gap-2" onSubmit={(e) => e.preventDefault()}>
            <input placeholder="you@company.com" className="h-11 flex-1 md:w-72 rounded-lg border border-white/12 bg-white/5 px-3.5 text-sm placeholder:text-white/35 outline-none focus:border-[#810FFB]/60" />
            <button className="h-11 px-5 rounded-lg bg-[#810FFB] text-sm font-semibold shadow-[0_0_16px_rgba(129,15,251,0.35)] hover:bg-[#9130ff] transition-colors">Subscribe</button>
          </form>
        </div>
      </section>
    </div>
  );
}
