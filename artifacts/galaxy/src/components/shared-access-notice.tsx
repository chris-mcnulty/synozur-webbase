import { ShieldAlert } from "lucide-react";

export function SharedAccessNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
      data-testid="shared-access-notice"
    >
      <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="text-foreground/85 leading-relaxed">
        <span className="font-semibold">Shared organization access, read-only.</span>{" "}
        Activity in this session is not attributable to an individual.
      </p>
    </div>
  );
}
