export type AssetKind = "image" | "document" | "video";

export const DOCUMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "text/plain",
  "text/csv",
];

export const DOCUMENT_MIME_PATTERNS: readonly RegExp[] = [
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/vnd\.ms-(powerpoint|excel)$/,
  /^application\/(zip|x-zip-compressed)$/,
  /^text\/(plain|csv)$/,
];

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isDocumentMime(mime: string): boolean {
  return DOCUMENT_MIME_PATTERNS.some((re) => re.test(mime));
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

export function assetKindOf(mime: string): AssetKind | null {
  if (isImageMime(mime)) return "image";
  if (isDocumentMime(mime)) return "document";
  if (isVideoMime(mime)) return "video";
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fileExtensionLabel(asset: {
  originalName: string;
  mimeType: string;
}): string {
  const dot = asset.originalName.lastIndexOf(".");
  if (dot > 0 && dot < asset.originalName.length - 1) {
    return asset.originalName.slice(dot + 1).toUpperCase();
  }
  const m = asset.mimeType.split("/")[1] ?? asset.mimeType;
  return m.toUpperCase();
}

export const IMAGE_ACCEPT_TYPES = ["image/*"];
export const DOCUMENT_ACCEPT_TYPES = [...DOCUMENT_MIME_TYPES];
export const VIDEO_ACCEPT_TYPES = ["video/*"];
