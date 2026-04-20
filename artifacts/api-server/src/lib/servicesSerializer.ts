import { eq, inArray, asc } from "drizzle-orm";
import {
  db,
  servicesTable,
  solutionsTable,
  serviceMethodologiesTable,
  solutionCapabilitiesTable,
  mediaTable,
  type Service,
  type Solution,
  type ServiceMethodology,
  type SolutionCapability,
} from "@workspace/db";

type IconRef = { id: string; publicUrl: string } | null;

async function loadIcons(ids: (string | null)[]): Promise<Map<string, { id: string; publicUrl: string }>> {
  const real = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (real.length === 0) return new Map();
  const rows = await db
    .select({ id: mediaTable.id, publicUrl: mediaTable.publicUrl })
    .from(mediaTable)
    .where(inArray(mediaTable.id, real));
  return new Map(rows.map((r) => [r.id, r]));
}

function shapeService(s: Service, icon: IconRef) {
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
    sourceId: s.sourceId,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function shapeSolution(s: Solution, icon: IconRef) {
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
    sourceId: s.sourceId,
    active: s.active,
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
  const icons = await loadIcons([s.iconId]);
  return shapeService(s, s.iconId ? icons.get(s.iconId) ?? null : null);
}

export async function serializeSolution(s: Solution): Promise<SolutionDto> {
  const icons = await loadIcons([s.iconId]);
  return shapeSolution(s, s.iconId ? icons.get(s.iconId) ?? null : null);
}

export async function serializeMethodology(m: ServiceMethodology): Promise<MethodologyDto> {
  const icons = await loadIcons([m.iconId]);
  return shapeMethodology(m, m.iconId ? icons.get(m.iconId) ?? null : null);
}

export async function serializeCapability(c: SolutionCapability): Promise<CapabilityDto> {
  const icons = await loadIcons([c.iconId]);
  return shapeCapability(c, c.iconId ? icons.get(c.iconId) ?? null : null);
}

/** List of all (active) services with their child solutions, ordered for header/overview rendering. */
export async function listServicesWithSolutions(): Promise<ServiceWithSolutions[]> {
  const services = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.active, true))
    .orderBy(asc(servicesTable.displayOrder), asc(servicesTable.title));
  const activeServices = services.filter((s) => !s.deletedAt);

  const solutions = await db
    .select()
    .from(solutionsTable)
    .where(eq(solutionsTable.active, true))
    .orderBy(asc(solutionsTable.displayOrder), asc(solutionsTable.title));
  const activeSolutions = solutions.filter((s) => !s.deletedAt);

  const iconIds = [
    ...activeServices.map((s) => s.iconId),
    ...activeSolutions.map((s) => s.iconId),
  ];
  const icons = await loadIcons(iconIds);

  const solutionsByParent = new Map<string, SolutionDto[]>();
  for (const sol of activeSolutions) {
    if (!sol.parentServiceId) continue;
    const dto = shapeSolution(sol, sol.iconId ? icons.get(sol.iconId) ?? null : null);
    const arr = solutionsByParent.get(sol.parentServiceId) ?? [];
    arr.push(dto);
    solutionsByParent.set(sol.parentServiceId, arr);
  }

  return activeServices.map((s) => ({
    ...shapeService(s, s.iconId ? icons.get(s.iconId) ?? null : null),
    solutions: solutionsByParent.get(s.id) ?? [],
  }));
}

export async function getServiceWithMethodologies(
  slug: string,
): Promise<ServiceWithMethodologies | null> {
  const service = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.slug, slug),
  });
  if (!service || service.deletedAt || !service.active) return null;
  const methodologies = await db
    .select()
    .from(serviceMethodologiesTable)
    .where(eq(serviceMethodologiesTable.serviceId, service.id))
    .orderBy(asc(serviceMethodologiesTable.displayOrder), asc(serviceMethodologiesTable.title));
  const visible = methodologies.filter((m) => !m.hidden);
  const icons = await loadIcons([service.iconId, ...visible.map((m) => m.iconId)]);
  return {
    ...shapeService(service, service.iconId ? icons.get(service.iconId) ?? null : null),
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
  if (!solution || solution.deletedAt || !solution.active) return null;
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
  const icons = await loadIcons([
    solution.iconId,
    parentService?.iconId ?? null,
    ...visible.map((c) => c.iconId),
  ]);
  return {
    ...shapeSolution(solution, solution.iconId ? icons.get(solution.iconId) ?? null : null),
    parentService:
      parentService && !parentService.deletedAt && parentService.active
        ? shapeService(
            parentService,
            parentService.iconId ? icons.get(parentService.iconId) ?? null : null,
          )
        : null,
    capabilities: visible.map((c) =>
      shapeCapability(c, c.iconId ? icons.get(c.iconId) ?? null : null),
    ),
  };
}
