import { useGetPortalMe, type PortalForbiddenReason } from "@workspace/api-client-react";
import { PortalShell } from "@/components/portal-shell";
import { Badge } from "@/components/ui/badge";
import {
  LIFECYCLE_STAGES,
  PlaceholderCard,
  StageHeader,
  StageSection,
} from "@/components/lifecycle";
import NotCustomer from "./not-customer";

const STAGE = LIFECYCLE_STAGES.find((s) => s.key === "outcomes")!;

export default function StageOutcomesPage() {
  const meQuery = useGetPortalMe();

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = meQuery.error as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();
  if (forbiddenReason) return <NotCustomer reason={forbiddenReason} />;

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <StageHeader
          stage={STAGE}
          description="Where the transformation becomes permanent. Vega surfaces an executive view of how the operating model is performing — outcomes only, no operator-level views."
        />

        <StageSection
          title="Executive overview"
          app="Vega"
          action={
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Integration pending
            </Badge>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <PlaceholderCard
              title="Current state of operations"
              description="A single executive snapshot of operations: where the new way of working is running, where it's stalled, and where it's compounding value."
            />
            <PlaceholderCard
              title="Outcome trendlines"
              description="Quarter-over-quarter movement on the outcome metrics tied to your transformation thesis."
            />
            <PlaceholderCard
              title="Adoption signal"
              description="High-level adoption telemetry rolled up to a leadership-friendly summary — no individual or team drill-downs."
            />
            <PlaceholderCard
              title="Strategic permanence"
              description="Where the transformation has been institutionalized into policy, structure, or routine — and where it hasn't yet."
            />
          </div>
        </StageSection>
      </main>
    </PortalShell>
  );
}
