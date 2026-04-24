import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";

export default function ItemDetail() {
  const [, params] = useRoute("/items/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug;

  useEffect(() => {
    if (slug) navigate(`/white-papers/${slug}`, { replace: true });
  }, [slug, navigate]);

  return (
    <div className="container mx-auto px-4 py-32 text-center text-muted-foreground">
      Redirecting…
    </div>
  );
}
