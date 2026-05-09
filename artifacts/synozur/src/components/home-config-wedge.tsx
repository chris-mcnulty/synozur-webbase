// HomeConfigWedge — the "configure this page without leaving the live
// site" gate for the home page (and its A/B variants). Distinct from
// `EditWedge`: the home page composes from `site_settings`,
// `publish_blocks` carousel, experiments, and featured collateral,
// so there's no single entity to PATCH inline. This wedge is a
// navigation-only chip that opens the relevant admin pages in new
// tabs.
//
// Why a separate component (instead of bolting onto EditWedge)?
//   - Different intent: navigation, not inline edit.
//   - Different gate: `site.manage` only (vs. `content.publish` for
//     editorial wedges).
//   - Different visual affordance (cog + secondary palette vs.
//     pencil + primary palette) so editors can tell the two apart.
//
// Mount this only on:
//   - `home.tsx` (Home A)
//   - `home-b.tsx` (Home B)
// `RootHomeRoute` in App.tsx renders one of those, so the chip is
// reachable from `/`, `/home-a`, and `/home-b` without an extra mount.
//
// Like EditWedge, the body is lazy-loaded so anonymous traffic
// doesn't pay for the dialog code.
import { lazy, Suspense } from "react";
import { useAdminAccess } from "@/components/admin/AdminGate";

const HomeConfigWedgeBody = lazy(() => import("./home-config-wedge-body"));

export function HomeConfigWedge() {
  const { access, signedIn } = useAdminAccess();

  if (!signedIn || !access) return null;
  if (!access.hasCapability("site.manage")) return null;

  return (
    <Suspense fallback={null}>
      <HomeConfigWedgeBody />
    </Suspense>
  );
}
