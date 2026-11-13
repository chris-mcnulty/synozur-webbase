// Heading-derived section ids and hash-only link detection for landing pages.
export function sectionId(heading?: string | null): string | undefined {
  if (!heading) return undefined;
  const id = heading
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || undefined;
}

export function isHashOnly(href: string): boolean {
  return href.length > 1 && href.startsWith("#");
}
