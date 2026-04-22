import { and, eq, inArray, isNull, asc, sql } from "drizzle-orm";
import {
  db,
  servicesTable,
  solutionsTable,
  serviceMethodologiesTable,
  solutionCapabilitiesTable,
  mediaTable,
  tagsTable,
  entityTagsTable,
  type Service,
  type Solution,
  type ServiceMethodology,
  type SolutionCapability,
  type TaxonomyEntityType,
} from "@workspace/db";

type IconRef = { id: string; publicUrl: string } | null;
type TagRef = { id: string; slug: string; name: string };

async function loadTags(
  entityType: TaxonomyEntityType,
  entityIds: string[],
): Promise<Map<string, TagRef[]>> {
  const result = new Map<string, TagRef[]>();
  if (entityIds.length === 0) return result;
  const rows = await db
    .select({
      entityId: entityTagsTable.entityId,
      id: tagsTable.id,
      slug: tagsTable.slug,
      name: tagsTable.name,
    })
    .from(entityTagsTable)
    .innerJoin(tagsTable, eq(entityTagsTable.tagId, tagsTable.id))
    .where(
      and(
        eq(entityTagsTable.entityType, entityType),
        inArray(entityTagsTable.entityId, entityIds),
      ),
    );
  for (const r of rows) {
    const arr = result.get(r.entityId) ?? [];
    arr.push({ id: r.id, slug: r.slug, name: r.name });
    result.set(r.entityId, arr);
  }
  return result;
}

export async function setEntityTags(
  entityType: TaxonomyEntityType,
  entityId: string,
  tagIds: string[],
): Promise<void> {
  await db
    .delete(entityTagsTable)
    .where(
      and(
        eq(entityTagsTable.entityType, entityType),
        eq(entityTagsTable.entityId, entityId),
      ),
    );
  if (tagIds.length === 0) return;
  await db.insert(entityTagsTable).values(
    tagIds.map((tagId) => ({
      entityType,
      entityId,
      tagId,
    })),
  );
}

async function loadIcons(ids: (string | null)[]): Promise<Map<string, { id: string; publicUrl: string }>> {
  const real = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (real.length === 0) return new Map();
  const rows = await db
    .select({ id: mediaTable.id, publicUrl: mediaTable.publicUrl })
    .from(mediaTable)
    .where(inArray(mediaTable.id, real));
  return new Map(rows.map((r) => [r.id, r]));
}

function shapeService(s: Service, icon: IconRef, tags: TagRef[]) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    displayOrder: s.displayOrder,
    parentServiceId: s.parentServiceId,
    iconId: s.iconId,
    iconUrl: icon?.publicUrl ?? null,
    servicePath: s.servicePath,
    overviewPath: s.overviewPath,
    buttonText: s.buttonText,
    heroTextHtml: s.heroTextHtml,
    secondaryTitle: s.secondaryTitle,
    secondaryTextHtml: s.secondaryTextHtml,
    tertiaryTitle: s.tertiaryTitle,
    tertiaryTextHtml: s.tertiaryTextHtml,
    blurbHtml: s.blurbHtml,
    blogCategory: s.blogCategory,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    sourceId: s.sourceId,
    status: s.status,
    publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
    unpublishedAt: s.unpublishedAt ? s.unpublishedAt.toISOString() : null,
    active: s.active,
    tags,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function shapeSolution(s: Solution, icon: IconRef, tags: TagRef[]) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    displayOrder: s.displayOrder,
    parentServiceId: s.parentServiceId,
    iconId: s.iconId,
    iconUrl: icon?.publicUrl ?? null,
    routePath: s.routePath,
    buttonText: s.buttonText,
    heroTextHtml: s.heroTextHtml,
    secondaryTitle: s.secondaryTitle,
    secondaryTextHtml: s.secondaryTextHtml,
    ourApproachTitle: s.ourApproachTitle,
    ourApproachTextHtml: s.ourApproachTextHtml,
    blurbHtml: s.blurbHtml,
    blurbCopy: s.blurbCopy,
    heroTextColor: s.heroTextColor,
    tagsText: s.tagsText,
    blogCategory: s.blogCategory,
    blogTag: s.blogTag,
    primaryBlogCategoryFilter: s.primaryBlogCategoryFilter,
    buttonUrl: s.buttonUrl,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    sourceId: s.sourceId,
    status: s.status,
    publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
    unpublishedAt: s.unpublishedAt ? s.unpublishedAt.toISOString() : null,
    pillar: s.pillar,
    active: s.active,
    tags,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function shapeMethodology(m: ServiceMethodology, icon: IconRef) {
  return {
    id: m.id,
    serviceId: m.serviceId,
    title: m.title,
    displayOrder: m.displayOrder,
    iconId: m.iconId,
    iconUrl: icon?.publicUrl ?? null,
    bodyHtml: m.bodyHtml,
    hidden: m.hidden,
    sourceId: m.sourceId,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function shapeCapability(c: SolutionCapability, icon: IconRef) {
  return {
    id: c.id,
    solutionId: c.solutionId,
    title: c.title,
    displayOrder: c.displayOrder,
    iconId: c.iconId,
    iconUrl: icon?.publicUrl ?? null,
    bodyHtml: c.bodyHtml,
    hidden: c.hidden,
    sourceId: c.sourceId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export type ServiceDto = ReturnType<typeof shapeService>;
export type SolutionDto = ReturnType<typeof shapeSolution>;
export type MethodologyDto = ReturnType<typeof shapeMethodology>;
export type CapabilityDto = ReturnType<typeof shapeCapability>;

export type ServiceWithSolutions = ServiceDto & { solutions: SolutionDto[] };
export type ServiceWithMethodologies = ServiceDto & { methodologies: MethodologyDto[] };
export type SolutionWithCapabilities = SolutionDto & {
  parentService: ServiceDto | null;
  capabilities: CapabilityDto[];
};

export async function serializeService(s: Service): Promise<ServiceDto> {
  const [icons, tags] = await Promise.all([
    loadIcons([s.iconId]),
    loadTags("service", [s.id]),
  ]);
  return shapeService(
    s,
    s.iconId ? icons.get(s.iconId) ?? null : null,
    tags.get(s.id) ?? [],
  );
}

export async function serializeSolution(s: Solution): Promise<SolutionDto> {
  const [icons, tags] = await Promise.all([
    loadIcons([s.iconId]),
    loadTags("solution", [s.id]),
  ]);
  return shapeSolution(
    s,
    s.iconId ? icons.get(s.iconId) ?? null : null,
    tags.get(s.id) ?? [],
  );
}

export async function serializeMethodology(m: ServiceMethodology): Promise<MethodologyDto> {
  const icons = await loadIcons([m.iconId]);
  return shapeMethodology(m, m.iconId ? icons.get(m.iconId) ?? null : null);
}

export async function serializeCapability(c: SolutionCapability): Promise<CapabilityDto> {
  const icons = await loadIcons([c.iconId]);
  return shapeCapability(c, c.iconId ? icons.get(c.iconId) ?? null : null);
}

/** List of all publicly-visible services with their child solutions, ordered for header/overview rendering. */
export async function listServicesWithSolutions(): Promise<ServiceWithSolutions[]> {
  const activeServices = await db
    .select()
    .from(servicesTable)
    .where(
      and(
        isNull(servicesTable.deletedAt),
        eq(servicesTable.active, true),
        eq(servicesTable.status, "published"),
        sql`(${servicesTable.publishedAt} is null or ${servicesTable.publishedAt} <= now())`,
        sql`(${servicesTable.unpublishedAt} is null or ${servicesTable.unpublishedAt} > now())`,
      ),
    )
    .orderBy(asc(servicesTable.displayOrder), asc(servicesTable.title));

  const activeSolutions = await db
    .select()
    .from(solutionsTable)
    .where(
      and(
        isNull(solutionsTable.deletedAt),
        eq(solutionsTable.active, true),
        eq(solutionsTable.status, "published"),
        sql`(${solutionsTable.publishedAt} is null or ${solutionsTable.publishedAt} <= now())`,
        sql`(${solutionsTable.unpublishedAt} is null or ${solutionsTable.unpublishedAt} > now())`,
      ),
    )
    .orderBy(asc(solutionsTable.displayOrder), asc(solutionsTable.title));

  const iconIds = [
    ...activeServices.map((s) => s.iconId),
    ...activeSolutions.map((s) => s.iconId),
  ];
  const [icons, serviceTags, solutionTags] = await Promise.all([
    loadIcons(iconIds),
    loadTags(
      "service",
      activeServices.map((s) => s.id),
    ),
    loadTags(
      "solution",
      activeSolutions.map((s) => s.id),
    ),
  ]);

  const solutionsByParent = new Map<string, SolutionDto[]>();
  for (const sol of activeSolutions) {
    if (!sol.parentServiceId) continue;
    const dto = shapeSolution(
      sol,
      sol.iconId ? icons.get(sol.iconId) ?? null : null,
      solutionTags.get(sol.id) ?? [],
    );
    const arr = solutionsByParent.get(sol.parentServiceId) ?? [];
    arr.push(dto);
    solutionsByParent.set(sol.parentServiceId, arr);
  }

  return activeServices.map((s) => ({
    ...shapeService(
      s,
      s.iconId ? icons.get(s.iconId) ?? null : null,
      serviceTags.get(s.id) ?? [],
    ),
    solutions: solutionsByParent.get(s.id) ?? [],
  }));
}

function withinPublishWindow(
  row: { publishedAt: Date | null; unpublishedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (row.publishedAt && row.publishedAt > now) return false;
  if (row.unpublishedAt && row.unpublishedAt <= now) return false;
  return true;
}

export async function getServiceWithMethodologies(
  slug: string,
): Promise<ServiceWithMethodologies | null> {
  const service = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.slug, slug),
  });
  if (
    !service ||
    service.deletedAt ||
    !service.active ||
    service.status !== "published" ||
    !withinPublishWindow(service)
  )
    return null;
  const methodologies = await db
    .select()
    .from(serviceMethodologiesTable)
    .where(eq(serviceMethodologiesTable.serviceId, service.id))
    .orderBy(asc(serviceMethodologiesTable.displayOrder), asc(serviceMethodologiesTable.title));
  const visible = methodologies.filter((m) => !m.hidden);
  const [icons, tags] = await Promise.all([
    loadIcons([service.iconId, ...visible.map((m) => m.iconId)]),
    loadTags("service", [service.id]),
  ]);
  return {
    ...shapeService(
      service,
      service.iconId ? icons.get(service.iconId) ?? null : null,
      tags.get(service.id) ?? [],
    ),
    methodologies: visible.map((m) =>
      shapeMethodology(m, m.iconId ? icons.get(m.iconId) ?? null : null),
    ),
  };
}

export async function getSolutionWithCapabilities(
  slug: string,
): Promise<SolutionWithCapabilities | null> {
  const solution = await db.query.solutionsTable.findFirst({
    where: eq(solutionsTable.slug, slug),
  });
  if (
    !solution ||
    solution.deletedAt ||
    !solution.active ||
    solution.status !== "published" ||
    !withinPublishWindow(solution)
  )
    return null;
  const capabilities = await db
    .select()
    .from(solutionCapabilitiesTable)
    .where(eq(solutionCapabilitiesTable.solutionId, solution.id))
    .orderBy(asc(solutionCapabilitiesTable.displayOrder), asc(solutionCapabilitiesTable.title));
  const visible = capabilities.filter((c) => !c.hidden);
  const parentService = solution.parentServiceId
    ? await db.query.servicesTable.findFirst({
        where: eq(servicesTable.id, solution.parentServiceId),
      })
    : null;
  const [icons, solutionTags, parentTags] = await Promise.all([
    loadIcons([
      solution.iconId,
      parentService?.iconId ?? null,
      ...visible.map((c) => c.iconId),
    ]),
    loadTags("solution", [solution.id]),
    parentService ? loadTags("service", [parentService.id]) : Promise.resolve(new Map()),
  ]);
  return {
    ...shapeSolution(
      solution,
      solution.iconId ? icons.get(solution.iconId) ?? null : null,
      solutionTags.get(solution.id) ?? [],
    ),
    parentService:
      parentService &&
      !parentService.deletedAt &&
      parentService.active &&
      parentService.status === "published" &&
      withinPublishWindow(parentService)
        ? shapeService(
            parentService,
            parentService.iconId ? icons.get(parentService.iconId) ?? null : null,
            parentTags.get(parentService.id) ?? [],
          )
        : null,
    capabilities: visible.map((c) =>
      shapeCapability(c, c.iconId ? icons.get(c.iconId) ?? null : null),
    ),
  };
}
