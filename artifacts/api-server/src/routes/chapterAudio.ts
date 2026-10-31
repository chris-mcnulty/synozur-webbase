import { Router, raw, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { CreateChapterAudioBody, ListChapterAudioResponse, ExtractChapterAudioResponse, ActionChapterAudioParams, EstimateChapterAudioBody, SaveChapterAudioPricingBody } from "@workspace/api-zod";
import { chapterAudioGuard, canManageChapterCosts } from "../lib/chapterAudio/access";
import { chapterAudioEnabled, publicChapter, getChapter, type ChapterRow } from "../lib/chapterAudio/repository";
import { MAX_WORDS, MAX_UPLOAD_BYTES, wordCount, splitNarration, extractChapter } from "../lib/chapterAudio/text";
import { CHAPTER_VOICES, isAzureTtsConfigured, getChapterSample } from "../lib/chapterAudio/speech";
import { chapterStorageConfigured, saveChapterFile, readChapterFile, readChapterAudioRange, deleteChapterFiles } from "../lib/chapterAudio/store";
import { chapterAudioRange } from "../lib/chapterAudio/delivery";
import { chapterEncoderReady } from "../lib/chapterAudio/assemble";
import { currentSpeechRate, saveSpeechRate, jobCostMap, monthlySpeechCosts } from "../lib/chapterAudio/costs";
import { makeNarration, estimateSpeech, summarizeUsage } from "../lib/chapterAudio/costMath";
import { getPublication } from "../lib/chapterAudio/publication";
import { GetChapterPublicationParams, GetChapterPublicationResponse, PrepareChapterPublicationParams } from "@workspace/api-zod";

const router: IRouter = Router();
const root = "/cms/chapter-audio";
const mutationLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, keyGenerator: req => req.authedUser!.id, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many audio requests. Please try again later." } });
const sampleLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, keyGenerator: req => req.authedUser!.id, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many sample requests. Please try again later." } });
router.use(root, chapterAudioGuard);

async function configured() { return chapterAudioEnabled() && isAzureTtsConfigured() && await chapterStorageConfigured() && chapterEncoderReady(); }

router.get(root, async (req, res): Promise<void> => {
  const { rows } = await pool.query<ChapterRow>(`SELECT * FROM chapter_audio_jobs ORDER BY created_at DESC LIMIT 200`);
  const costs = await jobCostMap(rows);
  res.json(ListChapterAudioResponse.parse({
    jobs: rows.map(row => publicChapter(row.expires_at <= new Date() ? { ...row, status: row.status === "deleting" ? "deleting" : "expired" } : row, costs.get(row.id))),
    voices: CHAPTER_VOICES, configured: await configured(), maxWords: MAX_WORDS, retentionDays: 30,
    pricing: { currentRate: await currentSpeechRate(), canManageRates: canManageChapterCosts(req.authedUser) },
  }));
});

const estimateLimit = rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: req => req.authedUser!.id, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many estimate requests. Please pause before editing again." } });
router.post(`${root}/estimate`, estimateLimit, async (req, res): Promise<void> => {
  const parsed = EstimateChapterAudioBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide chapter text and a supported voice." }); return; }
  const { text, notes, appendNotes, voice } = parsed.data;
  if (!(CHAPTER_VOICES as readonly string[]).includes(voice)) { res.status(400).json({ error: "Choose a supported Dragon HD voice." }); return; }
  const narration = makeNarration(text, notes, appendNotes);
  if (!text.trim() || wordCount(narration) > MAX_WORDS) { res.status(400).json({ error: "Provide 1–10,000 spoken words including any chapter notes." }); return; }
  try { res.json(estimateSpeech(narration, voice, await currentSpeechRate())); }
  catch { res.status(400).json({ error: "This text cannot be estimated. Check for an overlong word or URL." }); }
});

router.post(`${root}/pricing`, mutationLimit, async (req, res): Promise<void> => {
  if (!canManageChapterCosts(req.authedUser)) { res.status(403).json({ error: "Only site administrators may change speech rates." }); return; }
  const parsed = SaveChapterAudioPricingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a nonnegative rate, currency and effective date." }); return; }
  const { perMillion, currency, effectiveFrom } = parsed.data;
  const date = new Date(effectiveFrom);
  if (!Number.isFinite(date.getTime()) || !Intl.supportedValuesOf("currency").includes(currency) || Math.round(perMillion * 1e6) / 1e6 !== perMillion) {
    res.status(400).json({ error: "Use a valid effective date, ISO currency and rate with at most six decimal places." }); return;
  }
  res.json(await saveSpeechRate(perMillion, currency, date));
});

router.get(`${root}/costs`, async (req, res): Promise<void> => {
  if (!canManageChapterCosts(req.authedUser)) { res.status(403).json({ error: "Only site administrators may view monthly speech spending." }); return; }
  const month = req.query.month ?? new Date().toISOString().slice(0, 7);
  if (typeof month !== "string" || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({ error: "Use a month in YYYY-MM format (UTC)." }); return;
  }
  res.json(await monthlySpeechCosts(month));
});

router.post(`${root}/extract`, mutationLimit, raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }), async (req, res): Promise<void> => {
  try {
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Upload the file as application/octet-stream." }); return; }
    const filename = typeof req.query.filename === "string" ? req.query.filename : "";
    if (!filename || filename.length > 250) { res.status(400).json({ error: "A filename is required." }); return; }
    const result = await extractChapter(req.body, filename);
    if (!result.text) { res.status(400).json({ error: "No readable chapter text was found in this file." }); return; }
    res.json(ExtractChapterAudioResponse.parse(result));
  } catch (error) {
    // Parsing errors may contain manuscript fragments; never return provider/parser details.
    const safe = error instanceof Error && /^(Choose |Supported files|This Word|The file is not|The document must)/.test(error.message);
    res.status(400).json({ error: safe ? (error as Error).message : "This file could not be read safely. Use a valid .docx, UTF-8 .txt, or Markdown file." });
  }
});

router.post(root, mutationLimit, async (req, res): Promise<void> => {
  const parsed = CreateChapterAudioBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a title, chapter text, and supported voice within the allowed limits." }); return; }
  const { title, text, notes, appendNotes, voice } = parsed.data;
  if (!(CHAPTER_VOICES as readonly string[]).includes(voice)) { res.status(400).json({ error: "Select a supported Dragon HD voice." }); return; }
  const narration = makeNarration(text, notes, appendNotes);
  const count = wordCount(narration);
  if (!title.trim() || !text.trim() || count > MAX_WORDS) { res.status(400).json({ error: "Provide a title and chapter text, with no more than 10,000 words including spoken chapter notes." }); return; }
  let sections: string[];
  try { sections = splitNarration(narration); }
  catch { res.status(400).json({ error: "The chapter contains a word or URL too long to narrate. Shorten it before generating." }); return; }
  if (!await configured()) { res.status(503).json({ error: "Chapter Audio needs Azure Speech, SharePoint Embedded storage, and the MP3 encoder configured before rendering." }); return; }
  // A short transaction advisory lock serializes submissions and prevents queue floods across instances.
  const client = await pool.connect();
  const id = randomUUID();
  let uploaded = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(81675283)");
    const pending = await client.query("SELECT count(*)::integer AS count FROM chapter_audio_jobs WHERE status IN ('queued','processing') AND expires_at>now()");
    if (pending.rows[0].count >= 10) {
      await client.query("ROLLBACK");
      res.status(429).json({ error: "The chapter queue is full. Wait for an existing chapter to finish." }); return;
    }
    await saveChapterFile(`jobs/${id}/source.txt`, Buffer.from(narration), "text/plain; charset=utf-8");
    uploaded = true;
    const user = req.authedUser!;
    const estimate = estimateSpeech(narration, voice, await currentSpeechRate());
    const result = await client.query<ChapterRow>(`INSERT INTO chapter_audio_jobs
      (id,title,creator_id,creator_name,voice,word_count,total_chunks,initial_estimate,metering_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1) RETURNING *`,
    [id, title.trim(), user.id, user.displayName || user.email || "Editorial user", voice, count, sections.length, JSON.stringify(estimate)]);
    await client.query("COMMIT");
    res.status(201).json(ListChapterAudioResponse.shape.jobs.element.parse(publicChapter(result.rows[0]!, { initialEstimate: estimate, usage: summarizeUsage([]), legacyUsageGap: false })));
  } catch {
    await client.query("ROLLBACK");
    if (uploaded) await deleteChapterFiles(id).catch(() => req.log.warn({ chapterId: id }, "Unsubmitted chapter cleanup failed"));
    res.status(503).json({ error: "The chapter could not be queued. Please try again." });
  } finally { client.release(); }
});

router.get(`${root}/sample/:voice`, sampleLimit, async (req, res): Promise<void> => {
  const voice = String(req.params.voice);
  if (!(CHAPTER_VOICES as readonly string[]).includes(voice)) { res.status(400).json({ error: "Select a supported Dragon HD voice." }); return; }
  try {
    const user = req.authedUser!;
    const audio = await getChapterSample(voice, { actorId: user.id, actorLabel: user.displayName || "Editorial user" });
    res.type("audio/mpeg").setHeader("Content-Length", audio.length);
    res.send(audio);
  } catch {
    res.status(503).json({ error: "This Dragon HD voice sample could not be generated. Check Azure voice availability and the speech/storage connection." });
  }
});

router.get(`${root}/:id/publication`, async (req, res): Promise<void> => {
  const params = GetChapterPublicationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid chapter id." }); return; }
  const row = await getChapter(params.data.id);
  if (!row) { res.status(404).json({ error: "Chapter not found." }); return; }
  if (row.expires_at <= new Date()) { res.status(410).json({ error: "This chapter has expired." }); return; }
  if (row.status !== "completed") { res.status(409).json({ error: "The original narration is not available." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetChapterPublicationResponse.parse(await getPublication(row.id)));
});

router.post(`${root}/:id/publication`, mutationLimit, async (req, res): Promise<void> => {
  const params = PrepareChapterPublicationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid chapter id." }); return; }
  const result = await pool.query(`INSERT INTO chapter_audio_publications(job_id)
    SELECT id FROM chapter_audio_jobs WHERE id=$1 AND status='completed' AND expires_at>now()
    ON CONFLICT(job_id) DO UPDATE SET status='queued',error=null,created_at=now()
      WHERE chapter_audio_publications.status='failed'
    RETURNING job_id`, [params.data.id]);
  const row = await getChapter(params.data.id);
  if (!row) { res.status(404).json({ error: "Chapter not found." }); return; }
  if (row.expires_at <= new Date()) { res.status(410).json({ error: "This chapter has expired." }); return; }
  if (row.status !== "completed") { res.status(409).json({ error: "Finish narration before preparing a publication copy." }); return; }
  if (result.rowCount) req.log.info({ chapterId: row.id }, "Publication export queued");
  res.setHeader("Cache-Control", "private, no-store");
  res.status(202).json(GetChapterPublicationResponse.parse(await getPublication(row.id)));
});

router.post(`${root}/:id/:action`, mutationLimit, async (req, res): Promise<void> => {
  const params = ActionChapterAudioParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid chapter action." }); return; }
  const { id, action } = params.data;
  const row = await getChapter(id);
  if (!row) { res.status(404).json({ error: "Chapter not found." }); return; }
  if (action === "delete") {
    await pool.query("UPDATE chapter_audio_jobs SET status='deleting',error=null WHERE id=$1", [id]);
    res.json({ ok: true }); return;
  }
  if (row.expires_at <= new Date()) { res.status(410).json({ error: "This chapter has expired." }); return; }
  if (action === "cancel") {
    const result = await pool.query("UPDATE chapter_audio_jobs SET status='cancelled',error=null WHERE id=$1 AND status IN ('queued','processing')", [id]);
    if (!result.rowCount) { res.status(409).json({ error: "Only queued or processing chapters can be cancelled." }); return; }
  } else {
    if (!await configured()) { res.status(503).json({ error: "The speech, storage, or encoder configuration is unavailable." }); return; }
    const result = await pool.query(`UPDATE chapter_audio_jobs SET status='queued',error=null,processing_stage=null
      WHERE id=$1 AND status IN ('failed','cancelled') AND expires_at>now()
      AND (lease_until IS NULL OR lease_until<now())`, [id]);
    if (!result.rowCount) { res.status(409).json({ error: "This chapter cannot be retried yet. Wait for any in-progress section to stop, then try again." }); return; }
  }
  res.json({ ok: true });
});

router.get([`${root}/:id/audio`, `${root}/:id/publication/audio`], async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: "Invalid chapter id." }); return; }
  const row = await getChapter(id);
  if (!row) { res.status(404).json({ error: "Chapter not found." }); return; }
  if (row.expires_at <= new Date()) { res.status(410).json({ error: "This chapter has expired." }); return; }
  if (row.status !== "completed") { res.status(409).json({ error: "This chapter audio is not available." }); return; }
  try {
    const publication = req.path.endsWith("/publication/audio") ? await getPublication(id) : null;
    if (publication && publication.status !== "ready") {
      res.status(409).json({ error: "The publication export is not ready." }); return;
    }
    const size = publication ? publication.audioBytes ?? 0 : row.audio_bytes ?? 0;
    const key = publication ? publication.file_key : `jobs/${id}/audio.mp3`;
    // Media requests use small, verified SPE ranges instead of downloading and
    // returning the entire chapter on every browser seek/metadata request.
    if (req.headers.range) {
      const range = chapterAudioRange(req.headers.range, size);
      if (!range) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`); res.end(); return;
      }
      const bytes = await readChapterAudioRange(key, range.start, range.end, size);
      res.status(206).type("audio/mpeg");
      res.setHeader("Cache-Control", "private, no-store, no-transform");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", bytes.length);
      req.log.info({ chapterId: id, start: range.start, end: range.end, totalBytes: size }, "Chapter audio range delivered");
      res.send(bytes); return;
    }
    if (publication) {
      res.status(416).setHeader("Content-Range", `bytes */${size}`); res.end(); return;
    }
    const bytes = await readChapterFile(`jobs/${id}/audio.mp3`);
    res.type("audio/mpeg").setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store, no-transform");
    const filename = `${row.title.replace(/[^\w -]/g, "").trim().slice(0, 100) || "chapter"}.mp3`;
    res.setHeader("Content-Disposition", `${req.query.download === "true" ? "attachment" : "inline"}; filename="${filename}"`);
    res.setHeader("Content-Length", bytes.length);
    res.send(bytes);
  } catch {
    req.log.warn({ chapterId: id, ranged: !!req.headers.range }, "Chapter audio delivery failed");
    res.status(503).json({ error: "The chapter audio could not be downloaded. Please try again." });
  }
});

export default router;
