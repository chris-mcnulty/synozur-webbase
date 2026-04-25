import { useState, useEffect, useRef } from "react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { useAuth } from "@/context/auth";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type Status = "verifying" | "success" | "error" | "no-token";

export default function VerifyEmailPage() {
  const search = useSearch();
  const { refresh } = useAuth();
  const token = new URLSearchParams(search).get("token");

  const [status, setStatus] = useState<Status>(token ? "verifying" : "no-token");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!token || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/auth/verify-email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (res.ok && json.ok) {
          await refresh();
          setStatus("success");
        } else {
          setErrorMsg(json.error ?? "Verification failed.");
          setStatus("error");
        }
      } catch {
        setErrorMsg("Network error. Please try again.");
        setStatus("error");
      }
    })();
  }, [token, refresh]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Verify email" noindex />
      <div className="w-full max-w-sm text-center">
        {status === "verifying" && (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <h1 className="text-2xl font-bold mb-2">Verifying your email…</h1>
            <p className="text-muted-foreground text-sm">This will only take a moment.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Email verified</h1>
            <p className="text-muted-foreground text-sm mb-6">
              Your email address has been confirmed. Your account is now fully active.
            </p>
            <Button asChild className="w-full">
              <Link href="/admin">Continue to your account</Link>
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <svg className="h-7 w-7 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Verification failed</h1>
            <p className="text-muted-foreground text-sm mb-6">
              {errorMsg ?? "This verification link is invalid or has expired."}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </>
        )}

        {status === "no-token" && (
          <>
            <h1 className="text-2xl font-bold mb-2">No verification token</h1>
            <p className="text-muted-foreground text-sm mb-6">
              This page is only accessible from the link in your verification email.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
