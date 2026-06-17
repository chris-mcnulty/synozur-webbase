import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";
import { useAuth } from "@/context/auth";

export default function PendingApprovalPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Pending approval" noindex />
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
          <svg
            className="h-8 w-8 text-amber-600 dark:text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-3">Your organization is pending approval</h1>

        {user?.displayName && (
          <p className="text-muted-foreground text-sm mb-2">
            Welcome, <strong className="text-foreground">{user.displayName}</strong>.
          </p>
        )}

        <p className="text-muted-foreground text-sm mb-4">
          Your organization has been registered with Synozur and is awaiting
          review by our team. This typically takes one business day.
        </p>

        <p className="text-muted-foreground text-sm mb-8">
          You&apos;ll receive an email at{" "}
          <strong className="text-foreground">{user?.email ?? "your inbox"}</strong> as soon
          as your account is activated.
        </p>

        <div className="flex flex-col gap-3">
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Return to home</Link>
          </Button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-sm text-muted-foreground hover:text-foreground underline hover:no-underline transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
