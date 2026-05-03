import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function getInitial(): boolean {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      return window.matchMedia(REDUCED_MOTION_QUERY).matches;
    }
  } catch {
    // matchMedia unavailable
  }
  return false;
}

/**
 * Subscribes to the OS-level `prefers-reduced-motion` media query.
 *
 * Returns `true` when the user has asked the operating system to reduce
 * non-essential motion. Updates live if the preference changes mid-session.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(getInitial);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    // Sync once in case the value changed between SSR/initial state and mount.
    setReduced(mql.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  return reduced;
}
