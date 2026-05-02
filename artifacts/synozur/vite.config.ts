import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// In production, the platform's reverse proxy fronts both this SPA and the
// API server on a single domain (`/api/*` -> api-server, everything else
// -> SPA). When running `vite dev` or `vite preview` directly (local
// development outside the Replit dev domain, or the CI Playwright job),
// there is no such proxy, so we wire one up inline when
// `E2E_API_PROXY_TARGET` is set. This makes /api/* calls from the SPA
// reach the api-server in the same way the platform proxy does in prod.
const apiProxyTarget = process.env.E2E_API_PROXY_TARGET;
const proxyConfig = apiProxyTarget
  ? {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/.well-known": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/oauth": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    }
  : undefined;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    ...(proxyConfig ? { proxy: proxyConfig } : {}),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    ...(proxyConfig ? { proxy: proxyConfig } : {}),
  },
});
