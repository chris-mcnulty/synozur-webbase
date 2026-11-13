import type { RequestHandler } from "express";
import { chapterAudioEnabled, chapterAudioReady } from "./repository";

export const CHAPTER_AUDIO_ROLES = ["admin", "site_admin", "editor", "content_author"] as const;
export function canManageChapterCosts(user: { authProvider: string | null; roles: readonly string[] } | undefined) {
  return !!user && user.authProvider !== "api_key" && user.roles.some(role => role === "admin" || role === "site_admin");
}
export function canUseChapterAudio(user: { authProvider: string | null; roles: readonly string[] } | undefined): boolean {
  // Legacy author/contributor are NOT approved editorial-audience roles.
  // API-key capability equivalence must not widen this private human workflow.
  return !!user && user.authProvider !== "api_key" &&
    user.roles.some(role => (CHAPTER_AUDIO_ROLES as readonly string[]).includes(role));
}
export const chapterAudioGuard: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!chapterAudioEnabled()) { res.status(404).json({ error: "Not found" }); return; }
  if (!req.authedUser) { res.status(401).json({ error: "Sign in to access Chapter Audio." }); return; }
  if (!canUseChapterAudio(req.authedUser)) { res.status(403).json({ error: "Chapter Audio is available only to site administrators and editorial authors/editors, not Guest authors." }); return; }
  if (!chapterAudioReady()) { res.status(503).json({ error: "Chapter Audio is not initialized. Ask an administrator to check the service." }); return; }
  next();
};
