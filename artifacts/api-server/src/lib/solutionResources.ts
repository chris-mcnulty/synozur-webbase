import { isPublishedAtVisible } from "./publishWindow";

interface Resource {
  id: string;
  active: boolean;
  deletedAt: Date | null;
  publishedAt: Date | null;
}

interface ResourceLink<T> {
  c: T;
  link: { displayOrder: number; active: boolean };
}

/**
 * Explicit links take precedence, including an inactive link that suppresses
 * an otherwise directly assigned item. Append assignments after the curated
 * order; never add duplicate cards or fall back to unrelated service items.
 */
export function mergeSolutionResources<T extends Resource>(
  linked: ResourceLink<T>[],
  assigned: T[],
  preview = false,
  now = new Date(),
): ResourceLink<T>[] {
  const seen = new Set(linked.map((row) => row.c.id));
  let displayOrder = Math.max(-1, ...linked.map((row) => row.link.displayOrder)) + 1;
  const rows = [...linked];
  for (const c of assigned) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push({ c, link: { displayOrder: displayOrder++, active: true } });
  }
  return preview
    ? rows
    : rows.filter(({ c, link }) =>
        link.active && c.active && !c.deletedAt && isPublishedAtVisible(c.publishedAt, now),
      );
}