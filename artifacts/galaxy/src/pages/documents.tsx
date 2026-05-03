import { useEffect, useMemo, useState } from "react";
import {
  useListPortalDocuments,
  listPortalDocuments,
  useGetPortalMe,
  useListPortalDocumentVersions,
  type PortalDocument,
  type PortalDocumentVersion,
  type PortalForbiddenReason,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import NotCustomer from "./not-customer";
import { PortalShell } from "@/components/portal-shell";

// Page size used both server-side and to detect when more pages remain.
// Matches the API's max so a single round trip covers most engagements;
// any overflow is fetched via the pagination effect below.
const DOC_PAGE_SIZE = 100;

// Sort the docs list inside each engagement group. Defaults to most-recently
// modified first; clicking a column toggles direction.
type SortKey = "filename" | "lastModifiedAt" | "sizeBytes";
type SortDir = "asc" | "desc";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function isPdf(doc: PortalDocument): boolean {
  return /pdf/i.test(doc.contentType) || /\.pdf$/i.test(doc.filename);
}
function isImage(doc: PortalDocument): boolean {
  return doc.contentType.startsWith("image/");
}
function isOffice(doc: PortalDocument): boolean {
  if (
    /(officedocument|msword|ms-excel|ms-powerpoint|wordprocessingml|spreadsheetml|presentationml)/i.test(
      doc.contentType,
    )
  ) {
    return true;
  }
  return /\.(docx?|xlsx?|pptx?)$/i.test(doc.filename);
}

function fileTypeIcon(doc: PortalDocument): string {
  if (isPdf(doc)) return "📄";
  if (isImage(doc)) return "🖼️";
  if (isOffice(doc)) return "📊";
  return "📎";
}

function downloadUrl(id: string, inline = false): string {
  // Path-routed via the shared proxy — same origin as the Galaxy SPA, so
  // the api-server's session cookie travels with the request.
  return `/api/portal/documents/${id}/content${inline ? "?inline=1" : ""}`;
}

function versionDownloadUrl(
  id: string,
  versionId: string,
  inline = false,
): string {
  return `/api/portal/documents/${id}/versions/${encodeURIComponent(
    versionId,
  )}/content${inline ? "?inline=1" : ""}`;
}

export default function Documents() {
  const meQuery = useGetPortalMe();
  const docsQuery = useListPortalDocuments({ page: 1, pageSize: DOC_PAGE_SIZE });
  const [sortKey, setSortKey] = useState<SortKey>("lastModifiedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openDoc, setOpenDoc] = useState<PortalDocument | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The first page comes from the React Query hook; any subsequent pages
  // are fetched in the effect below so customers with >100 published files
  // see the complete list rather than a silently truncated first page.
  const [extraItems, setExtraItems] = useState<PortalDocument[]>([]);
  const [, setPaging] = useState(false);

  const forbiddenReason: PortalForbiddenReason | null = (() => {
    const err = (meQuery.error ?? docsQuery.error) as
      | { status?: number; data?: { reason?: PortalForbiddenReason } }
      | null
      | undefined;
    if (err && err.status === 403 && err.data?.reason) return err.data.reason;
    return null;
  })();

  useEffect(() => {
    if (!docsQuery.data) return;
    const firstPage = docsQuery.data.items ?? [];
    if (firstPage.length < DOC_PAGE_SIZE) {
      setExtraItems([]);
      return;
    }
    let cancelled = false;
    setPaging(true);
    (async () => {
      const acc: PortalDocument[] = [];
      let page = 2;
      // Hard cap so a runaway / pathological response can't loop forever.
      while (page <= 50) {
        try {
          const resp = await listPortalDocuments({
            page,
            pageSize: DOC_PAGE_SIZE,
          });
          const batch = resp.items ?? [];
          if (batch.length === 0) break;
          acc.push(...batch);
          if (batch.length < DOC_PAGE_SIZE) break;
          page++;
        } catch {
          break;
        }
      }
      if (!cancelled) {
        setExtraItems(acc);
        setPaging(false);
      }
    })();
    return () => {
      cancelled = true;
      setPaging(false);
    };
  }, [docsQuery.data]);

  const items = useMemo(
    () => [...(docsQuery.data?.items ?? []), ...extraItems],
    [docsQuery.data, extraItems],
  );

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; title: string; slug: string; docs: PortalDocument[] }
    >();
    for (const d of items) {
      let g = groups.get(d.engagementId);
      if (!g) {
        g = {
          id: d.engagementId,
          title: d.engagementTitle,
          slug: d.engagementSlug,
          docs: [],
        };
        groups.set(d.engagementId, g);
      }
      g.docs.push(d);
    }
    const cmp = (a: PortalDocument, b: PortalDocument): number => {
      let r = 0;
      if (sortKey === "filename") r = a.filename.localeCompare(b.filename);
      else if (sortKey === "sizeBytes") r = a.sizeBytes - b.sizeBytes;
      else {
        const at = a.lastModifiedAt ? new Date(a.lastModifiedAt).getTime() : 0;
        const bt = b.lastModifiedAt ? new Date(b.lastModifiedAt).getTime() : 0;
        r = at - bt;
      }
      return sortDir === "asc" ? r : -r;
    };
    return Array.from(groups.values())
      .map((g) => ({ ...g, docs: [...g.docs].sort(cmp) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [items, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "filename" ? "asc" : "desc");
    }
  }
  function toggleCollapsed(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "";

  if (forbiddenReason) {
    return <NotCustomer reason={forbiddenReason} />;
  }

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Documents
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Deliverables</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every status deck, requirements doc, and signed-off milestone your
            Synozur team has shared with you. Click a row to preview, or use
            Download to save a copy.
          </p>
        </section>

        {docsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : grouped.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-sm text-muted-foreground text-center">
              Nothing has been shared with you yet. When your account team
              publishes a deliverable, it will appear here.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => {
              const isCollapsed = collapsed.has(group.id);
              return (
                <section
                  key={group.id}
                  className="space-y-2"
                  data-testid={`group-${group.slug}`}
                >
                  <button
                    onClick={() => toggleCollapsed(group.id)}
                    className="flex items-baseline justify-between w-full text-left hover-elevate rounded-md px-2 py-1 -mx-2"
                    data-testid={`toggle-group-${group.slug}`}
                  >
                    <h2 className="text-lg font-semibold">
                      <span className="inline-block w-3 text-xs text-muted-foreground">
                        {isCollapsed ? "▸" : "▾"}
                      </span>{" "}
                      {group.title}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {group.docs.length}{" "}
                      {group.docs.length === 1 ? "file" : "files"}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <Card>
                      <CardContent className="p-0">
                        <table className="w-full text-sm">
                          <thead className="border-b border-border">
                            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="px-4 py-2.5 font-medium w-8" />
                              <th
                                className="px-2 py-2.5 font-medium cursor-pointer"
                                onClick={() => toggleSort("filename")}
                              >
                                Name {sortIndicator("filename")}
                              </th>
                              <th
                                className="px-2 py-2.5 font-medium cursor-pointer hidden md:table-cell"
                                onClick={() => toggleSort("lastModifiedAt")}
                              >
                                Modified {sortIndicator("lastModifiedAt")}
                              </th>
                              <th
                                className="px-2 py-2.5 font-medium cursor-pointer hidden sm:table-cell"
                                onClick={() => toggleSort("sizeBytes")}
                              >
                                Size {sortIndicator("sizeBytes")}
                              </th>
                              <th className="px-4 py-2.5 font-medium text-right w-32">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.docs.map((d) => (
                              <tr
                                key={d.id}
                                className="border-b border-border last:border-b-0 hover-elevate cursor-pointer"
                                onClick={() => setOpenDoc(d)}
                                data-testid={`doc-row-${d.id}`}
                              >
                                <td className="px-4 py-3 text-base">
                                  {fileTypeIcon(d)}
                                </td>
                                <td className="px-2 py-3 font-medium truncate max-w-[28ch]">
                                  {d.filename}
                                </td>
                                <td className="px-2 py-3 text-muted-foreground hidden md:table-cell">
                                  {formatDate(d.lastModifiedAt)}
                                </td>
                                <td className="px-2 py-3 text-muted-foreground hidden sm:table-cell">
                                  {formatBytes(d.sizeBytes)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-3">
                                    {!d.historyHidden && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenDoc(d);
                                        }}
                                        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                                        data-testid={`history-${d.id}`}
                                        title="View version history"
                                      >
                                        History
                                      </button>
                                    )}
                                    <a
                                      href={downloadUrl(d.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-sm text-primary hover:underline"
                                      data-testid={`download-${d.id}`}
                                    >
                                      Download
                                    </a>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      <Sheet open={openDoc != null} onOpenChange={(o) => !o && setOpenDoc(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {openDoc && (
            <>
              <SheetHeader>
                <SheetTitle className="break-words">{openDoc.filename}</SheetTitle>
                <SheetDescription>
                  {openDoc.engagementTitle} ·{" "}
                  {formatBytes(openDoc.sizeBytes)} ·{" "}
                  {formatDate(openDoc.lastModifiedAt)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <DocPreview doc={openDoc} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild data-testid={`drawer-download-${openDoc.id}`}>
                    <a href={downloadUrl(openDoc.id)}>Download</a>
                  </Button>
                  <Badge variant="secondary">{openDoc.contentType || "file"}</Badge>
                </div>
                <DocVersionHistory doc={openDoc} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PortalShell>
  );
}

function DocVersionHistory({ doc }: { doc: PortalDocument }) {
  const versionsQuery = useListPortalDocumentVersions(doc.id);
  if (doc.historyHidden) {
    // Admins can hide history per document. Don't render the section
    // at all in that case — surfacing a "history hidden" notice would
    // leak the existence of prior versions to the customer.
    return null;
  }
  const items: PortalDocumentVersion[] = versionsQuery.data?.items ?? [];
  // The newest entry from Graph mirrors the live driveItem, which the
  // primary Download button already targets. Hide it from the version
  // list so customers see only true "prior versions" of the deliverable.
  const priorVersions = items.filter((v) => !v.isCurrent);

  return (
    <Card data-testid={`version-history-${doc.id}`}>
      <CardContent className="p-5 space-y-3">
        <div>
          <p className="font-medium">Version history</p>
          <p className="text-xs text-muted-foreground">
            Earlier revisions retained by SharePoint, newest first.
          </p>
        </div>
        {versionsQuery.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : versionsQuery.error ? (
          <p className="text-sm text-muted-foreground">
            Could not load version history.
          </p>
        ) : priorVersions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No prior versions yet — this is the first revision.
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {priorVersions.map((v) => (
              <li
                key={v.versionId}
                className="flex items-center justify-between gap-3 py-2"
                data-testid={`version-row-${doc.id}-${v.versionId}`}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    Version {v.versionId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(v.lastModifiedAt)}
                    {v.modifiedByDisplayName
                      ? ` · ${v.modifiedByDisplayName}`
                      : ""}
                    {v.sizeBytes ? ` · ${formatBytes(v.sizeBytes)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {/*
                    Stream the historical version inline. PDFs/images render
                    in the new tab; Office files (docx/xlsx/pptx) hand off to
                    the OS-installed handler, which is the historical
                    equivalent of the live driveItem preview (Graph's
                    `driveItem:/preview` action does not accept a versionId).
                  */}
                  <a
                    href={versionDownloadUrl(doc.id, v.versionId, true)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    data-testid={`version-preview-${doc.id}-${v.versionId}`}
                  >
                    Preview
                  </a>
                  <a
                    href={versionDownloadUrl(doc.id, v.versionId)}
                    className="text-sm text-primary hover:underline"
                    data-testid={`version-download-${doc.id}-${v.versionId}`}
                  >
                    Download
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DocPreview({ doc }: { doc: PortalDocument }) {
  if (isPdf(doc)) {
    return (
      <iframe
        src={downloadUrl(doc.id, true)}
        title={doc.filename}
        className="w-full h-[70vh] rounded-md border border-border bg-muted"
        data-testid={`preview-pdf-${doc.id}`}
      />
    );
  }
  if (isImage(doc)) {
    return (
      <img
        src={downloadUrl(doc.id, true)}
        alt={doc.filename}
        className="max-w-full max-h-[70vh] rounded-md border border-border bg-muted object-contain mx-auto"
        data-testid={`preview-image-${doc.id}`}
      />
    );
  }
  if (isOffice(doc)) {
    // Office files don't render inline reliably in a same-origin iframe.
    // SPE returns a `webUrl` that opens the file in Microsoft 365 in the
    // browser (Word/Excel/PowerPoint Online), which is the correct
    // preview path for these formats. Fall back to a download CTA only
    // if SPE didn't return a webUrl for the item.
    return (
      <Card>
        <CardContent className="p-5 text-sm space-y-3">
          <p className="font-medium">Office document</p>
          <p className="text-muted-foreground">
            Open this file in Microsoft 365 in the browser, or download it
            to view in your local Office app.
          </p>
          {doc.hasPreview ? (
            <Button asChild variant="default" data-testid={`open-browser-${doc.id}`}>
              <a
                href={`/api/portal/documents/${doc.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in browser
              </a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-5 text-sm space-y-2">
        <p className="font-medium">Preview not available</p>
        <p className="text-muted-foreground">
          This file type isn't previewable in the browser yet. Use Download to
          save a copy.
        </p>
      </CardContent>
    </Card>
  );
}
