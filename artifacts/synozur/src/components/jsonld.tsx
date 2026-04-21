import { useEffect } from "react";

/**
 * Renders an `application/ld+json` script into `<head>` for the lifetime of
 * the component. Data is stringified each render; when the component
 * unmounts (or data changes) the previous script is removed to avoid
 * stacking stale snippets across client-side navigations.
 */
export function JsonLd({ data, id }: { data: unknown; id?: string }) {
  useEffect(() => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    if (id) script.id = id;
    script.text = JSON.stringify(data);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [data, id]);
  return null;
}
