import { ShieldAlert } from "lucide-react";
import {
  useCmsListCollateralPublishBlocks,
  type PublishBlock,
} from "@workspace/api-client-react";

interface Props {
  collateralId: string;
}

// #142 Phase D — Inline warn-mode banner. Renders nothing when there
// are no active blocks; otherwise lists the rule + reason for each.
// Editors take action either by improving the underlying signal (the
// linked admin page for media / route) or by overriding from the
// `/admin/site-config/health` page.
export function PublishBlocksBanner({ collateralId }: Props) {
  const { data } = useCmsListCollateralPublishBlocks(collateralId, {
    query: { enabled: !!collateralId } as never,
  });
  const blocks: PublishBlock[] = data?.items ?? [];
  if (blocks.length === 0) return null;

  return (
    <div
      className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
      data-testid="publish-blocks-banner"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium">
            {blocks.length === 1
              ? "1 quality block on this item or its route"
              : `${blocks.length} quality blocks on this item or its route`}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {blocks.map((b) => (
              <li key={b.id}>
                · <span className="font-mono">{b.sourceRule}</span> — {b.reason}
              </li>
            ))}
          </ul>
          <div className="mt-2 text-xs text-amber-200/80">
            Warn-mode v0 — publishing is not blocked yet. Resolve from the{" "}
            <a
              href="/admin/site-config/health"
              className="underline underline-offset-2 hover:text-amber-100"
            >
              Site Health
            </a>{" "}
            page (mandatory note for the audit log).
          </div>
        </div>
      </div>
    </div>
  );
}
