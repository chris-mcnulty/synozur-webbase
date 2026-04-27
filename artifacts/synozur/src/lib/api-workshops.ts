import type { LinkedBookingDto } from "./api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function url(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

export class WorkshopsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkshopsApiError";
    this.status = status;
  }
}

async function jsonFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const detail = obj && "error" in obj ? String(obj["error"]) : res.statusText;
    throw new WorkshopsApiError(`${res.status} ${detail}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type WorkshopCTA = { label: string; href: string };
export type WorkshopFAQItem = { q: string; a: string };

export interface WorkshopDto {
  id: string;
  slug: string;
  title: string;
  category: string;
  shortDescription: string;
  heroHeadline: string;
  heroSubhead: string;
  heroImage: string;
  heroTrustBullets: string[];
  primaryCTA: WorkshopCTA;
  secondaryCTA: WorkshopCTA | null;
  deliveryFormat: string;
  duration: string;
  whoItsFor: string[];
  idealParticipants: string[];
  prerequisites: string[];
  pain: { header: string; lead: string; tiles: string[] };
  scope: { header: string; summary: string; bullets: string[]; included: string[] };
  process: { header: string; steps: string[] };
  deliverables: {
    header: string;
    core: string[];
    executive: string[];
    enablement: string[];
    addOns: string[];
  };
  price: {
    label: string;
    startingAt?: number | null;
    display: string;
    timeline: string;
    whatIsIncluded: string[];
  };
  diagnostic: {
    header: string;
    summary: string;
    whatWeAssess: string[];
    questionnairePreview: string[];
    sampleOutputLink?: string | null;
  } | null;
  competitiveIntel: { header: string; summary: string; outputs: string[] } | null;
  toolingNote: string | null;
  outcomes: { header: string; bullets: string[] };
  beforeExample: string;
  afterExample: string;
  sampleDeliverables: { header: string; link?: string | null; thumbs: string[] };
  faq: { header: string; items: WorkshopFAQItem[] };
  seo: { title: string; description: string };
  displayOrder: number | null;
  serviceId: string | null;
  solutionId: string | null;
  bookingId: string | null;
  booking?: LinkedBookingDto | null;
  sourceId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WorkshopInput = Omit<
  WorkshopDto,
  "id" | "sourceId" | "booking" | "createdAt" | "updatedAt"
> & { slug?: string | null };

export const workshopsApi = {
  listPublic: () =>
    jsonFetch<{ items: WorkshopDto[] }>(url("/workshops")),
  getPublic: (slug: string) =>
    jsonFetch<WorkshopDto>(url(`/workshops/${encodeURIComponent(slug)}`)),
  listAdmin: () => jsonFetch<{ items: WorkshopDto[] }>(url("/cms/workshops")),
  getAdmin: (id: string) =>
    jsonFetch<WorkshopDto>(url(`/cms/workshops/${encodeURIComponent(id)}`)),
  create: (body: Partial<WorkshopInput> & { title: string }) =>
    jsonFetch<WorkshopDto>(url("/cms/workshops"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<WorkshopInput>) =>
    jsonFetch<WorkshopDto>(url(`/cms/workshops/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    jsonFetch<void>(url(`/cms/workshops/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
};

export function emptyWorkshopInput(): WorkshopInput {
  return {
    slug: "",
    title: "",
    category: "",
    shortDescription: "",
    heroHeadline: "",
    heroSubhead: "",
    heroImage: "",
    heroTrustBullets: [],
    primaryCTA: { label: "Request a Private Workshop", href: "https://www.synozur.com/start" },
    secondaryCTA: null,
    deliveryFormat: "",
    duration: "",
    whoItsFor: [],
    idealParticipants: [],
    prerequisites: [],
    pain: { header: "", lead: "", tiles: [] },
    scope: { header: "", summary: "", bullets: [], included: [] },
    process: { header: "How it works", steps: [] },
    deliverables: { header: "Deliverables", core: [], executive: [], enablement: [], addOns: [] },
    price: { label: "Starting at", startingAt: null, display: "", timeline: "", whatIsIncluded: [] },
    diagnostic: null,
    competitiveIntel: null,
    toolingNote: null,
    outcomes: { header: "Outcomes", bullets: [] },
    beforeExample: "",
    afterExample: "",
    sampleDeliverables: { header: "Sample deliverables (available on request)", link: null, thumbs: [] },
    faq: { header: "FAQ", items: [] },
    seo: { title: "", description: "" },
    displayOrder: null,
    serviceId: null,
    solutionId: null,
    bookingId: null,
    active: true,
  };
}
