import { eq } from "drizzle-orm";
import {
  db,
  jobApplicationsTable,
  jobPostingsTable,
  type JobApplication,
  type JobPosting,
} from "@workspace/db";
import { logger } from "./logger";

// #223 — Background AI scoring for inbound applications. Uses the AI
// integrations proxy when AI_INTEGRATIONS_ANTHROPIC_* env vars are set; falls
// back to a deterministic heuristic when the proxy is not configured so dev
// and CI environments don't require a key. The score is a 0–100 integer plus
// a short reasoning string saved on the application row.

interface ScoreResult {
  score: number;
  reasoning: string;
}

function heuristicScore(
  app: Pick<
    JobApplication,
    "experience" | "education" | "coverLetter" | "linkedinUrl"
  >,
  job: Pick<JobPosting, "title" | "description" | "requirementsParagraphs"> | null,
): ScoreResult {
  let score = 50;
  const reasons: string[] = [];
  if (app.experience && app.experience.length > 80) {
    score += 10;
    reasons.push("Detailed work history.");
  }
  if (app.education && app.education.length > 20) {
    score += 5;
    reasons.push("Education provided.");
  }
  if (app.coverLetter && app.coverLetter.length > 200) {
    score += 10;
    reasons.push("Substantive cover letter.");
  }
  if (app.linkedinUrl) {
    score += 5;
    reasons.push("LinkedIn profile included.");
  }
  if (job) {
    const haystack = [
      app.experience ?? "",
      app.coverLetter ?? "",
      app.education ?? "",
    ]
      .join(" ")
      .toLowerCase();
    const requirements = (job.requirementsParagraphs ?? []).join(" ").toLowerCase();
    const tokens = requirements
      .split(/\s+/)
      .filter((t) => t.length > 5)
      .slice(0, 12);
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    if (tokens.length > 0) {
      const bonus = Math.round((hits / tokens.length) * 20);
      score += bonus;
      reasons.push(`${hits}/${tokens.length} requirement keywords matched.`);
    }
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    reasoning:
      reasons.length > 0
        ? reasons.join(" ")
        : "Heuristic baseline score (no proxy configured).",
  };
}

async function aiScore(
  app: JobApplication,
  job: JobPosting | null,
): Promise<ScoreResult> {
  if (
    !process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ||
    !process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"]
  ) {
    return heuristicScore(app, job);
  }
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const requirements = (job?.requirementsParagraphs ?? []).join("\n- ");
    const prompt = `Score this candidate 0-100 for a ${job?.title ?? "general"} role.
Requirements:
- ${requirements}

Candidate experience: ${app.experience ?? "n/a"}
Candidate education: ${app.education ?? "n/a"}
Candidate cover letter: ${app.coverLetter ?? "n/a"}

Reply ONLY with JSON: {"score": <0-100 int>, "reasoning": "<one sentence>"}`;
    const resp = await anthropic.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristicScore(app, job);
    const parsed = JSON.parse(match[0]) as { score?: number; reasoning?: string };
    const score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 50)));
    return {
      score,
      reasoning: parsed.reasoning ?? "AI scoring complete.",
    };
  } catch (err) {
    logger.warn({ err }, "careers-ai: scoring failed, using heuristic");
    return heuristicScore(app, job);
  }
}

export function scheduleApplicationScoring(applicationId: string): void {
  // Fire-and-forget. The submit handler returns 201 immediately; the score
  // backfills onto the row when it lands.
  setImmediate(() => {
    void runScoring(applicationId).catch((err) => {
      logger.warn({ err, applicationId }, "careers-ai: background scoring failed");
    });
  });
}

export async function runScoring(applicationId: string): Promise<ScoreResult | null> {
  const app = await db.query.jobApplicationsTable.findFirst({
    where: eq(jobApplicationsTable.id, applicationId),
  });
  if (!app) return null;
  const job = app.jobPostingId
    ? (await db.query.jobPostingsTable.findFirst({
        where: eq(jobPostingsTable.id, app.jobPostingId),
      })) ?? null
    : null;
  const result = await aiScore(app, job);
  await db
    .update(jobApplicationsTable)
    .set({
      aiMatchScore: result.score,
      aiMatchReasoning: result.reasoning,
      aiScoredAt: new Date(),
    })
    .where(eq(jobApplicationsTable.id, applicationId));
  return result;
}
