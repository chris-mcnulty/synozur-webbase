import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { fetchCollateralBySlug } from "@/data/collateral";

export default function ItemDetail() {
  const [, params] = useRoute("/items/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug;

  useEffect(() => {
    if (!slug) return;
    fetchCollateralBySlug(slug)
      .then((item) => {
        // Redirect to the item's canonical URL when available; fall back to
        // the legacy white-papers path for items not yet in collateral.
        const target = item?.url ?? `/white-papers/${slug}`;
        navigate(target, { replace: true });
      })
      .catch(() => {
        navigate(`/white-papers/${slug}`, { replace: true });
      });
  }, [slug, navigate]);

  return (
    <div className="container mx-auto px-4 py-32 text-center text-muted-foreground">
      Redirecting…
    </div>
  );
}
