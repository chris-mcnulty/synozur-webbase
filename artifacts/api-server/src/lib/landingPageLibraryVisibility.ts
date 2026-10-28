export interface LandingPageLibraryState {
  featured: boolean;
  libraryListed?: boolean;
  active: boolean;
  status: string;
  deletedAt?: Date | null;
  publishedAt?: Date | null;
  unpublishedAt?: Date | null;
}

export function isLandingPageLibraryEligible(
  page: LandingPageLibraryState,
  now = new Date(),
): boolean {
  return Boolean(
    (page.featured || page.libraryListed) &&
    page.active &&
    page.status === "published" &&
    !page.deletedAt &&
    (!page.publishedAt || page.publishedAt <= now) &&
    (!page.unpublishedAt || page.unpublishedAt > now),
  );
}
