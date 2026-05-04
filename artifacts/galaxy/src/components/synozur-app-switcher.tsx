import { useState, useRef, useEffect } from "react";

const BRAND_PRIMARY = "#810FFB";
const BRAND_SECONDARY = "#E60CB3";

const BASE = (import.meta.env.BASE_URL || "/galaxy/").replace(/\/+$/, "");

const SYNOZUR_APPS = [
  {
    id: "synozur",
    name: "Synozur",
    tagline: "Home",
    description: "Explore Synozur's AI-powered platform, insights, and resources.",
    url: "/",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M3 10.5L12 3L21 10.5V20A1 1 0 0120 21H15V16H9V21H4A1 1 0 013 20V10.5Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "galaxy",
    name: "Galaxy",
    tagline: "Customer Portal",
    description: "Access your engagements, documents, and Synozur application suite.",
    url: `${BASE}/`,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.08" />
        <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <ellipse cx="12" cy="12" rx="3.5" ry="9" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <circle cx="12" cy="12" r="2" fill="currentColor" fillOpacity="0.7" />
      </svg>
    ),
  },
  {
    id: "vega",
    name: "Vega",
    tagline: "Company Operating System",
    description: "AI-augmented strategy, goals, execution, governance, and insight in one place.",
    url: "https://vega.synozur.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      </svg>
    ),
  },
  {
    id: "constellation",
    name: "Constellation",
    tagline: "Delivery & Financial Management",
    description: "Time, cost, progress tracking with estimates, invoicing, and reporting.",
    url: "https://constellation.synozur.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="12" cy="5" r="1.5" fill="currentColor" />
        <circle cx="6" cy="10" r="1.5" fill="currentColor" />
        <circle cx="18" cy="10" r="1.5" fill="currentColor" />
        <circle cx="8" cy="17" r="1.5" fill="currentColor" />
        <circle cx="16" cy="17" r="1.5" fill="currentColor" />
        <line x1="12" y1="5" x2="6" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="12" y1="5" x2="18" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="6" y1="10" x2="8" y2="17" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="18" y1="10" x2="16" y2="17" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="6" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        <line x1="8" y1="17" x2="16" y2="17" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      </svg>
    ),
  },
  {
    id: "nebula",
    name: "Nebula",
    tagline: "Innovation & Envisioning",
    description: "Co-design strategy, surface insights, and turn ideas into shared direction.",
    url: "https://nebula.synozur.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1" opacity="0.2" />
        <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" fillOpacity="0.6" />
        <circle cx="9" cy="8" r="1" fill="currentColor" fillOpacity="0.3" />
        <circle cx="16" cy="10" r="0.8" fill="currentColor" fillOpacity="0.3" />
        <circle cx="14" cy="16" r="0.6" fill="currentColor" fillOpacity="0.3" />
      </svg>
    ),
  },
  {
    id: "orion",
    name: "Orion",
    tagline: "Transformation & Maturity",
    description: "AI-powered maturity assessments with actionable roadmaps for change.",
    url: "https://orion.synozur.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="8" cy="6" r="1.5" fill="currentColor" fillOpacity="0.8" />
        <circle cx="11" cy="9" r="1.2" fill="currentColor" fillOpacity="0.8" />
        <circle cx="14" cy="12" r="1.8" fill="currentColor" />
        <circle cx="16" cy="16" r="1" fill="currentColor" fillOpacity="0.6" />
        <line x1="8" y1="6" x2="11" y2="9" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
        <line x1="11" y1="9" x2="14" y2="12" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
        <line x1="14" y1="12" x2="16" y2="16" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
      </svg>
    ),
  },
  {
    id: "zenith",
    name: "Zenith",
    tagline: "M365 AI Content Governance",
    description: "AI-powered content governance, compliance, and lifecycle management for Microsoft 365.",
    url: "https://zenith.synozur.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M12 2L4 8V16L12 22L20 16V8L12 2Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.1" />
        <path d="M12 2V22" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
        <path d="M4 8L20 16" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
        <path d="M20 8L4 16" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" fillOpacity="0.5" />
      </svg>
    ),
  },
  {
    id: "orbit",
    name: "Orbit",
    tagline: "Go-to-Market Intelligence",
    description: "Competitive and market insights for positioning, prioritization, and action.",
    url: "https://orbit.synozur.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="1" />
        <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1" opacity="0.5" transform="rotate(-30 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1" opacity="0.5" transform="rotate(30 12 12)" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

export type GalaxyAppId =
  | "synozur"
  | "galaxy"
  | "vega"
  | "constellation"
  | "nebula"
  | "orion"
  | "zenith"
  | "orbit";

interface SynozurAppSwitcherProps {
  currentApp?: GalaxyAppId;
  forceDark?: boolean;
}

export function SynozurAppSwitcher({
  currentApp = "galaxy",
  forceDark = false,
}: SynozurAppSwitcherProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const fd = forceDark;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? "synozur-app-menu" : undefined}
        className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
          fd
            ? `hover:bg-white/10 text-gray-400 hover:text-white ${open ? "bg-white/10 text-white" : ""}`
            : `hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white ${open ? "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white" : ""}`
        }`}
        title="Synozur Apps"
        aria-label="Synozur Apps"
        data-testid="button-synozur-app-switcher"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
          <rect x="1" y="1" width="4" height="4" rx="0.8" />
          <rect x="6" y="1" width="4" height="4" rx="0.8" />
          <rect x="11" y="1" width="4" height="4" rx="0.8" />
          <rect x="1" y="6" width="4" height="4" rx="0.8" />
          <rect x="6" y="6" width="4" height="4" rx="0.8" />
          <rect x="11" y="6" width="4" height="4" rx="0.8" />
          <rect x="1" y="11" width="4" height="4" rx="0.8" />
          <rect x="6" y="11" width="4" height="4" rx="0.8" />
          <rect x="11" y="11" width="4" height="4" rx="0.8" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="synozur-app-menu"
          role="menu"
          aria-label="Synozur Suite Applications"
          className={`absolute top-full left-0 sm:left-auto sm:right-0 mt-2 w-[360px] max-w-[calc(100vw-1rem)] rounded-xl shadow-2xl border z-[100] overflow-hidden ${
            fd
              ? "bg-gray-950 border-white/10"
              : "bg-white dark:bg-gray-950 border-gray-200 dark:border-white/10"
          }`}
          style={{ animation: "synozurAppSwitcherFadeIn 0.15s ease-out" }}
        >
          <style>{`@keyframes synozurAppSwitcherFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>

          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold tracking-[0.2em] uppercase ${fd ? "text-gray-500" : "text-gray-400 dark:text-gray-500"}`}>Synozur Suite</span>
            </div>
          </div>

          <div className="px-2 pb-3 space-y-0.5">
            {SYNOZUR_APPS.map((app, index) => {
              const isCurrent = app.id === currentApp;
              const accentColor = index % 2 === 0 ? BRAND_PRIMARY : BRAND_SECONDARY;
              const isExternal = app.url.startsWith("http");
              return (
                <a
                  key={app.id}
                  href={isCurrent ? undefined : app.url}
                  target={(!isCurrent && isExternal) ? "_blank" : undefined}
                  rel={(!isCurrent && isExternal) ? "noopener noreferrer" : undefined}
                  role="menuitem"
                  onClick={isCurrent ? (e) => { e.preventDefault(); closeMenu(); } : () => closeMenu()}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all group cursor-pointer ${
                    isCurrent
                      ? fd
                        ? "bg-white/[0.08] ring-1 ring-white/10"
                        : "bg-gray-100 dark:bg-white/[0.08] ring-1 ring-gray-200 dark:ring-white/10"
                      : fd
                        ? "hover:bg-white/[0.06]"
                        : "hover:bg-gray-50 dark:hover:bg-white/[0.06]"
                  }`}
                  data-testid={`app-switcher-item-${app.id}`}
                >
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center mt-0.5"
                    style={{
                      backgroundColor: `${accentColor}15`,
                      color: accentColor,
                    }}
                  >
                    {app.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${fd ? "text-white" : "text-gray-900 dark:text-white"}`}>{app.name}</span>
                      {isCurrent && (
                        <span className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-full ${
                          fd ? "bg-white/10 text-gray-400" : "bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-gray-400"
                        }`}>
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium mt-0.5" style={{ color: accentColor }}>
                      {app.tagline}
                    </p>
                    <p className="text-[11px] text-gray-500 leading-snug mt-0.5">
                      {app.description}
                    </p>
                  </div>
                  {!isCurrent && (
                    <svg viewBox="0 0 16 16" fill="none" className={`w-3.5 h-3.5 transition-colors mt-1.5 flex-shrink-0 ${
                      fd ? "text-gray-600 group-hover:text-gray-400" : "text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400"
                    }`}>
                      <path d="M5 3L10 8L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </a>
              );
            })}
          </div>

          <div className={`border-t px-4 py-2.5 ${fd ? "border-white/5" : "border-gray-100 dark:border-white/5"}`}>
            <a
              href="/applications"
              className={`text-[11px] transition-colors ${fd ? "text-gray-500 hover:text-gray-300" : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"}`}
            >
              Learn more at synozur.com
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
