/**
 * One-shot migration seed: hydrates the `polaris_episodes` table from the
 * inline array that used to live in `artifacts/synozur/src/pages/polaris.tsx`
 * (#101). Idempotent — keyed by `episode_number` using ON CONFLICT DO NOTHING.
 *
 * Runs after `pnpm --filter @workspace/db run push` has applied the schema.
 */
import { db, polarisEpisodesTable } from "@workspace/db";
import { toSlug } from "../lib/slug";

interface Seed {
  episodeNumber: number;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  artworkUrl: string;
  appleUrl: string;
  audioUrl: string;
  summary: string;
}

const EPISODES: Seed[] = [
  {
    episodeNumber: 53,
    title: "Inside Microsoft 365 E7, Or, How Four Equals Seven",
    publishedAt: "2026-03-24",
    durationSeconds: 16 * 60,
    artworkUrl: "/images/polaris/ep-m365-e7.jpg",
    appleUrl:
      "https://podcasts.apple.com/us/podcast/inside-microsoft-365-e7-or-how-four-equals-seven/id1773172041?i=1000757146174",
    audioUrl:
      "https://traffic.libsyn.com/secure/4b50c5db-fc98-4391-b363-96ab432ae6e1/riverside_ep.053_-m365-e7_chris_mcnultys_stu.mp3?dest-id=4755027",
    summary:
      "We explore Microsoft's game-changing March 2026 announcements — including the Microsoft 365 E7 \"Frontier Suite,\" Agent 365 for AI governance, and the new Copilot Cowork capability — and unpack what these innovations mean for business and technology leaders navigating the AI-powered future.",
  },
  {
    episodeNumber: 51,
    title: "AI in 2026: A Trillion Dollars Is Coming. Who's Going to Win It?",
    publishedAt: "2026-03-17",
    durationSeconds: 15 * 60,
    artworkUrl: "/images/polaris/ep-ai-2026.png",
    appleUrl:
      "https://podcasts.apple.com/us/podcast/ai-in-2026-a-trillion-dollars-is-coming-whos-going-to-win-it/id1773172041?i=1000755875857",
    audioUrl:
      "https://traffic.libsyn.com/secure/4b50c5db-fc98-4391-b363-96ab432ae6e1/riverside_ep.051_-_chris_final_final_final_chris_mcnultys_stu.mp3?dest-id=4755027",
    summary:
      "The global AI market is on track to reach nearly a trillion dollars by 2030. And yet, most organizations sit at a score of 260 out of 500 on AI maturity — past the experiment phase, but nowhere near scaled. That's the core finding of the Synozur 2026 AI Report, and it's also the subject of the latest episode of Polaris Pulse.",
  },
  {
    episodeNumber: 33,
    title: "Never Sit in the Lobby: Glenn Poulos on Sales, Startups, and Survival",
    publishedAt: "2026-03-10",
    durationSeconds: 40 * 60,
    artworkUrl: "/images/polaris/ep-glenn-poulos.jpg",
    appleUrl:
      "https://podcasts.apple.com/us/podcast/never-sit-in-the-lobby-glenn-poulos-on-sales-startups/id1773172041?i=1000754582564",
    audioUrl:
      "https://traffic.libsyn.com/secure/4b50c5db-fc98-4391-b363-96ab432ae6e1/riverside_polaris_033_-_glenn_poulos_final_final_chris_mcnultys_stu.mp3?dest-id=4755027",
    summary:
      "Polaris is a production of Synozur — the transformation company. Glenn Poulos, co-founder of Gap Wireless and author of Never Sit in the Lobby, shares how he built and sold multiple businesses across three decades, reveals why face-to-face relationships still matter in the AI age, and explains how mid-market companies can leverage technology without losing their human touch.",
  },
];

async function main() {
  for (const ep of EPISODES) {
    const slug = toSlug(ep.title);
    await db
      .insert(polarisEpisodesTable)
      .values({
        slug,
        title: ep.title,
        episodeNumber: ep.episodeNumber,
        summary: ep.summary,
        audioUrl: ep.audioUrl,
        appleUrl: ep.appleUrl,
        durationSeconds: ep.durationSeconds,
        artworkUrl: ep.artworkUrl,
        status: "published",
        publishedAt: new Date(ep.publishedAt),
        sourceId: `libsyn:${ep.episodeNumber}`,
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${EPISODES.length} polaris episodes (idempotent).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
