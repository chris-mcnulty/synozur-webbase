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

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // SSR / private browsing
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

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, siteTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
