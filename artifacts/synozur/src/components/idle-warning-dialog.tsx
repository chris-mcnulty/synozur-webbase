import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIdleWarning } from "@/hooks/use-idle-warning";
import { useAuth } from "@/context/auth";

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) {
    return `${m} minute${m !== 1 ? "s" : ""} ${s} second${s !== 1 ? "s" : ""}`;
  }
  return `${s} second${s !== 1 ? "s" : ""}`;
}

function IdleWarningDialogInner() {
  const { isSignedIn, signOut } = useAuth();
  const { showWarning, secondsLeft, staySignedIn, dismiss } = useIdleWarning();
  const [staying, setStaying] = useState(false);

  if (!isSignedIn) return null;

  const handleStay = async () => {
    setStaying(true);
    try {
      await staySignedIn();
    } finally {
      setStaying(false);
    }
  };

  // Closing via X or pressing Escape dismisses the dialog (deferred sign-out).
  const handleOpenChange = (open: boolean) => {
    if (!open) dismiss();
  };

  return (
    <Dialog open={showWarning} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md"
        // Prevent accidental dismissal — user must make an explicit choice.
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <DialogTitle>You'll be signed out soon</DialogTitle>
          </div>
          <DialogDescription className="pt-1">
            You've been inactive for a while. To protect your account, you'll
            be automatically signed out in{" "}
            <span className="font-medium text-foreground">
              {formatCountdown(secondsLeft)}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          {/* Sign out now performs an immediate, synchronous sign-out. */}
          <Button
            variant="outline"
            onClick={() => void signOut()}
            disabled={staying}
          >
            Sign out now
          </Button>
          <Button onClick={() => void handleStay()} disabled={staying}>
            {staying ? "Extending session…" : "Stay signed in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IdleWarningDialog() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return null;
  return <IdleWarningDialogInner />;
}
