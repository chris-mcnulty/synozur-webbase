import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import { useToast } from "@/hooks/use-toast";
import {
  trafficPropertiesApi,
  type ImportResult,
} from "@/lib/traffic-properties-api";
import { Upload, FileJson, FileSpreadsheet, AlertCircle } from "lucide-react";

type Mode = "json" | "csv";

// Canonical fields the server's normalizer recognizes. Anything else is
// dropped during transformation. Required fields are marked so the UI can
// show a warning when they're not mapped.
//
// Special key "_ip": not sent to the server directly. When sessionKey is
// not mapped but _ip + viewedAt are, the client synthesizes a sessionKey
// from "ip|date" per row (handles Wix exports, which have no session ID).
const CANONICAL_FIELDS: Array<{ key: string; required?: boolean; aliases: string[] }> = [
  {
    key: "path",
    required: true,
    aliases: ["path", "page", "url", "page path", "page_path", "page url", "page address"],
  },
  {
    key: "viewedAt",
    required: true,
    aliases: [
      "viewedat", "viewed_at", "timestamp", "date", "datetime", "time",
      "visit date", "visit_date",
    ],
  },
  {
    key: "sessionKey",
    required: true,
    aliases: [
      "sessionkey", "session_key", "session_id", "sessionid",
      "visitor_id", "visitor", "visitor id",
      "contact_id", "contact id", "contactid",
      "user_id", "user id", "userid",
      "unique id", "unique_id",
    ],
  },
  // _ip is a synthetic helper — auto-detected from "IP address" columns.
  // When sessionKey is absent, it's combined with viewedAt to build one.
  {
    key: "_ip",
    aliases: ["ip address", "ip_address", "ip addr", "ip", "ipaddress"],
  },
  { key: "title", aliases: ["title", "page title", "page_title"] },
  {
    key: "pageviewCount",
    aliases: ["pageviewcount", "pageviews", "views", "page views", "page_views"],
  },
  {
    key: "timeOnPageMs",
    aliases: ["timeonpagems", "time_on_page", "duration_ms", "avg. time on page", "time on page"],
  },
  { key: "pageType", aliases: ["pagetype", "page_type", "type"] },
  {
    key: "referrerUrl",
    aliases: ["referrerurl", "referrer", "referer", "traffic source url", "traffic_source_url"],
  },
  { key: "referrerHost", aliases: ["referrerhost", "referrer_host"] },
  {
    key: "trafficSource",
    aliases: [
      "trafficsource", "source", "channel",
      "traffic category", "traffic_category",
    ],
  },
  {
    key: "utmSource",
    aliases: ["utmsource", "utm_source", "utm campaign source", "utm_campaign_source"],
  },
  {
    key: "utmMedium",
    aliases: ["utmmedium", "utm_medium", "utm campaign medium", "utm_campaign_medium"],
  },
  {
    key: "utmCampaign",
    aliases: ["utmcampaign", "utm_campaign", "utm campaign name", "utm_campaign_name"],
  },
  {
    key: "utmTerm",
    aliases: ["utmterm", "utm_term", "utm campaign keywords", "utm_campaign_keywords"],
  },
  {
    key: "utmContent",
    aliases: ["utmcontent", "utm_content", "utm campaign content", "utm_campaign_content"],
  },
  { key: "country", aliases: ["country", "country_code"] },
  { key: "region", aliases: ["region", "state", "province"] },
  { key: "city", aliases: ["city"] },
  {
    key: "deviceType",
    aliases: ["devicetype", "device_type", "device", "device type"],
  },
  {
    key: "browserName",
    aliases: ["browsername", "browser", "browser name"],
  },
  {
    key: "browserVersion",
    aliases: ["browserversion", "browser_version", "browser version"],
  },
  {
    key: "osName",
    aliases: ["osname", "os", "operating_system", "operating system"],
  },
  { key: "userAgent", aliases: ["useragent", "user_agent", "ua"] },
];

const CANONICAL_KEYS = CANONICAL_FIELDS.map((f) => f.key);

function parseCsvPreview(csv: string, max = 6): { headers: string[]; rows: string[][] } {
  // Lightweight CSV parse — good enough for preview. Full parse happens
  // server-side via the same parseCsvAsObjects helper that powers ingest.
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQ = true;
      } else if (c === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]!);
  const rows = lines.slice(1, max + 1).map(split);
  return { headers, rows };
}

function autoDetectMapping(headers: string[]): Record<string, string> {
  // For each source header, pick the canonical key whose alias list contains
  // the (lowercased) header, falling back to "" (= drop).
  const map: Record<string, string> = {};
  for (const h of headers) {
    const norm = h.trim().toLowerCase();
    const hit = CANONICAL_FIELDS.find((f) => f.aliases.includes(norm));
    map[h] = hit ? hit.key : "";
  }
  return map;
}

export default function TrafficImportPage() {
  const { access } = useAdminAccess();
  const enabled = !!access?.hasCapability("content.moderate");
  const { toast } = useToast();

  const propsQ = useQuery({
    queryKey: ["traffic-properties"],
    queryFn: () => trafficPropertiesApi.list(),
    enabled,
  });

  const importable = useMemo(
    () => (propsQ.data?.items ?? []).filter((p) => !p.isDefault && p.isActive),
    [propsQ.data],
  );

  const [propertySlug, setPropertySlug] = useState<string>("");
  const [mode, setMode] = useState<Mode>("json");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);
  // Pre-fill from query string when admins click "Re-upload" in the
  // import-history dialog on the Properties page. The original file content
  // is never persisted server-side (only its sha256), so we cannot restore
  // the bytes — but we can at least put them on the right form, with the
  // right format and a hint about the file name they previously used.
  const [reuploadHint, setReuploadHint] = useState<{
    fileName: string;
    sha256: string | null;
  } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("property");
    const kind = params.get("kind");
    const file = params.get("file");
    const sha = params.get("sha256");
    if (slug) setPropertySlug(slug);
    if (kind === "json" || kind === "csv") setMode(kind);
    if (file) {
      setFileName(file);
      setReuploadHint({ fileName: file, sha256: sha });
    }
  }, []);
  // CSV column mapping — recomputed whenever the CSV content changes.
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});

  const csvPreview = useMemo(
    () => (mode === "csv" && content.trim() ? parseCsvPreview(content) : { headers: [], rows: [] }),
    [mode, content],
  );

  // Auto-detect mapping when headers change (e.g. file upload). User edits
  // override but lose on next file load — matches typical import UX.
  const headersKey = csvPreview.headers.join("|");
  useMemo(() => {
    if (mode === "csv" && csvPreview.headers.length > 0) {
      setColumnMap((prev) => {
        const isEmpty = Object.keys(prev).length === 0;
        const headerSetChanged = csvPreview.headers.some((h) => !(h in prev));
        if (isEmpty || headerSetChanged) return autoDetectMapping(csvPreview.headers);
        return prev;
      });
    }
    return null;
  }, [headersKey, mode, csvPreview.headers]);

  // Session synthesis: when no sessionKey column exists but _ip + viewedAt do,
  // the client will emit sessionKey = "ip|date" for each row.
  const mappedValues = Object.values(columnMap);
  const hasSessionKey = mappedValues.includes("sessionKey");
  const hasIpCol = mappedValues.includes("_ip");
  const hasViewedAtCol = mappedValues.includes("viewedAt");
  const willSynthesizeSession = !hasSessionKey && hasIpCol && hasViewedAtCol;

  const missingRequired = CANONICAL_FIELDS.filter((f) => f.required).filter((f) => {
    if (f.key === "sessionKey" && willSynthesizeSession) return false;
    return !mappedValues.includes(f.key);
  });

  // Wix "Traffic category" values → our canonical trafficSource values.
  const WIX_SOURCE_MAP: Record<string, string> = {
    "organic social": "social",
    "direct": "direct",
    "referral": "referral",
    "ai platforms": "ai",
    "organic search": "organic",
    "paid search": "paid",
    "paid social": "paid",
    "email": "referral",
    "paid email": "paid",
  };

  function buildRemappedCsv(): string {
    // Rewrite the CSV header row using the user's mapping, dropping
    // un-mapped columns and the synthetic _ip helper.
    // The server's parseCsvAsObjects will then see canonical keys directly.
    const cols = csvPreview.headers
      .map((h, idx) => ({ h, idx, target: columnMap[h] ?? "" }))
      .filter((c) => c.target && c.target !== "_ip");

    // For session synthesis: find source column indices for ip and viewedAt.
    const ipSrcIdx = willSynthesizeSession
      ? csvPreview.headers.findIndex((h) => columnMap[h] === "_ip")
      : -1;
    const dateSrcIdx = willSynthesizeSession
      ? csvPreview.headers.findIndex((h) => columnMap[h] === "viewedAt")
      : -1;

    // Find index of trafficSource output column (for value normalization).
    const trafficSrcOutputIdx = cols.findIndex((c) => c.target === "trafficSource");
    // Find index of deviceType output column (for lowercase normalization).
    const deviceTypeOutputIdx = cols.findIndex((c) => c.target === "deviceType");

    const header = [
      ...cols.map((c) => c.target),
      ...(willSynthesizeSession ? ["sessionKey"] : []),
    ].join(",");

    const lines = content.split(/\r?\n/);
    const dataLines = lines.slice(1).filter((l) => l.length > 0);

    const splitFn = (line: string): string[] => {
      const out: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') inQ = false;
          else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
      out.push(cur);
      return out;
    };

    const escape = (s: string) =>
      /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

    const remapped = dataLines.map((line) => {
      const parts = splitFn(line);
      const cells = cols.map((c, outIdx) => {
        let val = (parts[c.idx] ?? "").trim();
        // Normalize Wix "Traffic category" values to canonical trafficSource.
        if (outIdx === trafficSrcOutputIdx) {
          val = WIX_SOURCE_MAP[val.toLowerCase()] ?? val.toLowerCase();
        }
        // Normalize device type to lowercase (Wix exports "Desktop"/"Mobile"/"Tablet").
        if (outIdx === deviceTypeOutputIdx) {
          val = val.toLowerCase();
        }
        return escape(val);
      });
      // Synthesize sessionKey = "ip|date" when no native session column.
      if (willSynthesizeSession) {
        const ip = (parts[ipSrcIdx] ?? "").trim();
        const date = (parts[dateSrcIdx] ?? "").trim();
        cells.push(escape(`${ip}|${date}`));
      }
      return cells.join(",");
    });

    return [header, ...remapped].join("\n");
  }

  const importM = useMutation({
    mutationFn: async () => {
      if (!propertySlug) throw new Error("Pick a property");
      if (mode === "json") {
        let rows: Array<Record<string, unknown>>;
        try {
          const parsed: unknown = JSON.parse(content);
          if (!Array.isArray(parsed)) throw new Error("JSON must be an array of row objects");
          rows = parsed as Array<Record<string, unknown>>;
        } catch (e) {
          throw new Error(`JSON parse error: ${(e as Error).message}`);
        }
        return trafficPropertiesApi.importJson({
          propertySlug,
          rows,
          fileName: fileName || undefined,
        });
      }
      const csvToSend =
        csvPreview.headers.length > 0 && Object.keys(columnMap).length > 0
          ? buildRemappedCsv()
          : content;
      return trafficPropertiesApi.importCsv({
        propertySlug,
        csv: csvToSend,
        fileName: fileName || undefined,
      });
    },
    onSuccess: (res) => {
      setResult(res);
      toast({
        title: `Import complete`,
        description: `Accepted ${res.accepted}, duplicates ${res.duplicates}, errors ${res.errors}`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    void file.text().then((t) => setContent(t));
    if (file.name.toLowerCase().endsWith(".csv")) setMode("csv");
    else if (file.name.toLowerCase().endsWith(".json")) setMode("json");
  }

  return (
    <AdminLayout
      title="Import Traffic Data"
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Marketing" },
        { label: "Traffic Import" },
      ]}
    >
      {!enabled ? (
        <Card className="p-6 bg-muted/30">
          <p className="text-sm">You don&apos;t have access to import traffic data.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 text-sm text-muted-foreground">
            Upload pageview data for a registered property. Each row needs at least a{" "}
            <code>path</code>, <code>viewedAt</code> (ISO 8601), and <code>sessionKey</code>{" "}
            (a stable per-session identifier). Re-uploading the same file is safe — duplicates are
            de-duped by <code>(sessionKey, path, viewedAt)</code>.
          </Card>

          {reuploadHint && (
            <Card
              className="p-4 text-sm border-primary/40 bg-primary/5"
              data-testid="card-reupload-hint"
            >
              <div className="font-medium mb-1">Re-importing a previous file</div>
              <div className="text-muted-foreground">
                Property and format are pre-selected from the previous import of{" "}
                <code className="font-mono text-xs">{reuploadHint.fileName}</code>. The original
                file is not stored, so pick the same file from your machine below.
                {reuploadHint.sha256 && (
                  <>
                    {" "}
                    For reference, the previous upload had sha256{" "}
                    <code className="font-mono text-xs">
                      {reuploadHint.sha256.slice(0, 16)}…
                    </code>{" "}
                    — you can verify locally with <code>shasum -a 256</code> if you want to be
                    sure it&apos;s the same file.
                  </>
                )}{" "}
                Imports are idempotent: rows already ingested are counted as duplicates rather
                than re-inserted, so re-importing is always safe.
              </div>
            </Card>
          )}

          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Property</Label>
                <Select value={propertySlug} onValueChange={setPropertySlug}>
                  <SelectTrigger data-testid="select-import-property">
                    <SelectValue placeholder="Pick a property…" />
                  </SelectTrigger>
                  <SelectContent>
                    {importable.map((p) => (
                      <SelectItem key={p.id} value={p.slug}>
                        {p.name} ({p.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {importable.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Create a non-default property first on the Properties page.
                  </p>
                )}
              </div>
              <div>
                <Label>Format</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">
                      <FileJson className="h-3.5 w-3.5 inline mr-1" /> JSON array
                    </SelectItem>
                    <SelectItem value="csv">
                      <FileSpreadsheet className="h-3.5 w-3.5 inline mr-1" /> CSV with headers
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>File (optional)</Label>
                <input
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={onFile}
                  className="block w-full text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:bg-muted file:text-foreground"
                  data-testid="input-file"
                />
              </div>
            </div>

            <div className="mt-4">
              <Label>Content</Label>
              <Textarea
                rows={10}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  mode === "json"
                    ? `[\n  { "sessionKey": "abc", "path": "/", "viewedAt": "2025-04-01T12:00:00Z" }\n]`
                    : `path,viewedAt,sessionKey\n/,2025-04-01T12:00:00Z,abc`
                }
                className="font-mono text-xs"
                data-testid="textarea-import-content"
              />
            </div>

            {mode === "csv" && csvPreview.headers.length > 0 && (
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-sm font-medium mb-1">Column mapping</div>
                  <div className="text-xs text-muted-foreground mb-2">
                    Map each source column to a canonical field. Headers we recognize are
                    pre-filled; pick &quot;(skip)&quot; for columns you don&apos;t want to import.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {csvPreview.headers.map((h) => (
                      <div key={h} className="flex items-center gap-2 text-xs">
                        <code className="px-1.5 py-0.5 bg-muted rounded shrink-0 truncate max-w-[40%]">
                          {h}
                        </code>
                        <span className="text-muted-foreground">→</span>
                        <select
                          className="flex-1 border rounded px-2 py-1 text-xs bg-background"
                          value={columnMap[h] ?? ""}
                          onChange={(e) =>
                            setColumnMap((m) => ({ ...m, [h]: e.target.value }))
                          }
                          data-testid={`map-${h}`}
                        >
                          <option value="">(skip)</option>
                          {CANONICAL_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.key === "_ip" ? "_ip (use to synthesize session key)" : f.key}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {willSynthesizeSession && (
                    <div className="mt-2 text-xs text-blue-600 flex items-start gap-1">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        No session ID column found — a <code>sessionKey</code> will be synthesized
                        from <strong>IP address + Date</strong> per row. Same IP on the same day
                        counts as one session. Re-importing the same file is idempotent.
                      </span>
                    </div>
                  )}
                  {missingRequired.length > 0 && (
                    <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Missing required mapping for: {missingRequired.map((f) => f.key).join(", ")}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Preview ({csvPreview.rows.length} rows)</div>
                  <div className="overflow-x-auto border rounded">
                    <table className="text-xs w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          {csvPreview.headers.map((h) => (
                            <th key={h} className="px-2 py-1 text-left font-medium">
                              {h}
                              {columnMap[h] && (
                                <span className="text-muted-foreground"> → {columnMap[h]}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.rows.map((row, i) => (
                          <tr key={i} className="border-t">
                            {row.map((cell, j) => (
                              <td key={j} className="px-2 py-1 font-mono text-muted-foreground truncate max-w-[160px]">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end mt-3">
              <Button
                onClick={() => importM.mutate()}
                disabled={
                  !propertySlug ||
                  !content.trim() ||
                  importM.isPending ||
                  (mode === "csv" && missingRequired.length > 0)
                }
                data-testid="btn-import"
              >
                <Upload className="h-4 w-4 mr-1" />
                {importM.isPending ? "Importing…" : "Import"}
              </Button>
            </div>
          </Card>

          {result && (
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-2">Import result</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Rows parsed</div>
                  <div className="font-semibold text-lg">{result.rowsParsed}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Accepted</div>
                  <div className="font-semibold text-lg text-green-500" data-testid="text-accepted">
                    {result.accepted}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Duplicates</div>
                  <div className="font-semibold text-lg" data-testid="text-duplicates">
                    {result.duplicates}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                  <div className="font-semibold text-lg">{result.skipped}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Errors</div>
                  <div className="font-semibold text-lg text-red-500" data-testid="text-errors">
                    {result.errors}
                  </div>
                </div>
              </div>
              {result.errorSamples.length > 0 && (
                <div className="mt-4 text-xs">
                  <div className="font-medium flex items-center gap-1 mb-2">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" /> First {result.errorSamples.length} errors
                  </div>
                  <ul className="space-y-1 font-mono">
                    {result.errorSamples.map((e, i) => (
                      <li key={i} className="text-muted-foreground">
                        row #{e.index}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
