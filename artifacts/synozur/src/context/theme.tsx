import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Theme = "dark" | "light";
type SiteTheme = "cosmic" | "aurora";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  siteTheme: SiteTheme;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  siteTheme: "cosmic",
});

const STORAGE_KEY = "synozur-theme";
const LIGHT_MEDIA_QUERY = "(prefers-color-scheme: light)";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // SSR / private browsing
  }
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(LIGHT_MEDIA_QUERY).matches
    ) {
      return "light";
    }
  } catch {
    // matchMedia unavailable
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const { data: siteSettings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 5 * 60 * 1000,
  });

  const siteTheme: SiteTheme =
    siteSettings?.siteTheme === "aurora" ? "aurora" : "cosmic";

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    const html = document.documentElement;
    if (siteTheme === "aurora") {
      html.classList.add("theme-aurora");
    } else {
      html.classList.remove("theme-aurora");
    }
  }, [siteTheme]);

  // Mirror the user's dark/light preference onto <html> so the body bg stays
  // continuous across route swaps (admin <-> public). Without this, the
  // dark class lives only on per-route wrapper divs and the body briefly
  // shows its light bg between unmount and remount, causing a white flash.
  useEffect(() => {
    const html = document.documentElement;
    if (theme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [theme]);

  // Follow OS prefers-color-scheme until the user explicitly toggles. Once
  // localStorage has a stored choice, the explicit choice wins.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(LIGHT_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY) !== null) return;
      } catch {
        return;
      }
      setTheme(event.matches ? "light" : "dark");
    };
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, siteTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
