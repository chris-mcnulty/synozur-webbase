export function toEmbedUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === "youtube.com" && u.pathname.startsWith("/embed/")) {
      return url;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.replace(/^\//, "");
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === "player.vimeo.com") return url;
    if (/wistia\.(net|com)$/.test(host) && u.pathname.includes("/embed/")) {
      return url;
    }
  } catch {
    // fall through
  }
  return null;
}
