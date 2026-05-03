import { ShieldAlert } from "lucide-react";

export interface BotCheckCalloutProps {
  className?: string;
  compact?: boolean;
}

export function BotCheckCallout({ className, compact = false }: BotCheckCalloutProps) {
  return (
    <div
      role="alert"
      className={[
        "flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-100",
        compact ? "p-3" : "p-4",
        className ?? "",
      ].join(" ")}
    >
      <ShieldAlert className={compact ? "h-4 w-4 mt-0.5 shrink-0 text-amber-400" : "h-5 w-5 mt-0.5 shrink-0 text-amber-400"} />
      <div className={compact ? "text-xs leading-relaxed" : "text-sm leading-relaxed"}>
        <p className="font-semibold text-amber-200">The bot check did not pass.</p>
        <p className="mt-1 text-amber-100/90">
          This is an automated security check that helps us keep spam off the site.
          We&apos;ve refreshed it for you — please complete the challenge again and resend.
        </p>
      </div>
    </div>
  );
}
