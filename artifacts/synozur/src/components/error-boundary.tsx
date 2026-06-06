import { Component, type ErrorInfo, type ReactNode } from "react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/**
 * Forward a caught render error to whatever error-tracking sink is wired up.
 *
 * Today this only logs to the console. When client-side error tracking lands
 * (see BACKLOG.md → "Pre-launch review: deferred items" item 1 — Sentry or
 * equivalent), capture the error here, e.g. `Sentry.captureException(error,
 * { contexts: { react: { componentStack } } })`. Keeping the funnel in one
 * place means the SDK wires in with a one-line change and every boundary
 * benefits.
 */
function reportBoundaryError(error: Error, info: ErrorInfo): void {
  console.error("[ErrorBoundary] uncaught render error", error, info.componentStack);
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Render-prop fallback. Receives the error and a `reset` callback that
   * clears the boundary's error state so the subtree can attempt to remount.
   */
  fallback: (args: { error: Error; reset: () => void }) => ReactNode;
  /**
   * When this value changes, the boundary clears its error state. Used to
   * auto-recover on route changes so a single crashed page doesn't wedge the
   * whole session — navigating away renders cleanly.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportBoundaryError(error, info);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}

/**
 * Full-screen branded fallback for catastrophic, app-level failures (a render
 * error that escaped the router/providers). Intentionally self-contained: it
 * does not use the router, data fetching, or the <Meta> component, because the
 * boundary that renders it may sit above those very systems. The only action
 * is a hard reload plus a same-origin link home.
 */
export function FullPageErrorFallback({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      className="relative w-full min-h-screen overflow-hidden bg-[#0B0B1A]"
      role="alert"
      data-testid="app-error-boundary"
    >
      <div className="absolute inset-0 nebula-gradient opacity-25" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 70% 60%, white, transparent), radial-gradient(1px 1px at 40% 80%, white, transparent), radial-gradient(2px 2px at 85% 20%, white, transparent), radial-gradient(1px 1px at 10% 70%, white, transparent), radial-gradient(1px 1px at 55% 15%, white, transparent)",
          backgroundSize: "100% 100%",
        }}
      />
      <div className="relative z-10 max-w-2xl mx-auto px-4 py-24 text-center">
        <p className="text-sm uppercase tracking-widest text-primary mb-4">
          Something went wrong
        </p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
          We hit an unexpected error.
        </h1>
        <p className="text-lg text-zinc-300 mb-10">
          The page ran into a problem on our end. Reloading usually fixes it —
          if it keeps happening, please let us know.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={() => {
              reset();
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            data-testid="app-error-reload"
          >
            Reload the page
          </button>
          <a
            href={`${BASE_PATH}/`}
            className="inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Return home
          </a>
        </div>
        <p className="mt-8 text-sm text-zinc-400">
          Need a hand?{" "}
          <a href={`${BASE_PATH}/contact`} className="text-primary hover:underline">
            Contact us
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * Lighter fallback for a single marketing page that crashed while the site
 * chrome (header/footer) is intact. Renders inside the Layout, so it stays
 * compact and offers an in-place retry plus navigation. The surrounding
 * boundary is keyed on the current location, so moving to another page clears
 * the error automatically.
 */
export function RouteErrorFallback({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      className="mx-auto max-w-2xl px-4 py-24 text-center"
      role="alert"
      data-testid="route-error-boundary"
    >
      <p className="text-sm uppercase tracking-widest text-primary mb-4">
        Something went wrong
      </p>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
        This page didn&rsquo;t load correctly.
      </h1>
      <p className="text-base text-muted-foreground mb-10">
        Sorry about that — the rest of the site is still working. Try again, or
        head back to the homepage.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          data-testid="route-error-retry"
        >
          Try again
        </button>
        <a
          href={`${BASE_PATH}/`}
          className="inline-flex h-11 items-center justify-center rounded-md border px-6 text-sm font-medium transition-colors hover:bg-accent"
        >
          Return home
        </a>
      </div>
    </div>
  );
}
