import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./context/auth";
import { ErrorBoundary, FullPageErrorFallback } from "./components/error-boundary";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary fallback={(args) => <FullPageErrorFallback {...args} />}>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>,
);

// Register the service worker for offline support and faster repeat visits
// (task #246). We only register in production builds — running it against
// the Vite dev server would intercept HMR requests and cache stale modules.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        // When a new SW takes control (because we bumped CACHE_VERSION on a
        // new deploy), reload once so the user sees the fresh build instead
        // of a cached stale shell.
        let hasReloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (hasReloaded) return;
          hasReloaded = true;
          window.location.reload();
        });

        // If a waiting worker is already there on first load, tell it to
        // activate immediately.
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version ready — apply it on the next tick.
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {
        // Service worker registration is a progressive enhancement — failures
        // shouldn't break the page.
      });
  });
}
