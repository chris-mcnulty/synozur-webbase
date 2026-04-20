import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const CLERK_PROXY_URL = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={PUBLISHABLE_KEY}
    proxyUrl={CLERK_PROXY_URL}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    signInFallbackRedirectUrl={`${basePath}/admin`}
    signUpFallbackRedirectUrl={`${basePath}/admin`}
    afterSignOutUrl={`${basePath}/`}
  >
    <App />
  </ClerkProvider>,
);
