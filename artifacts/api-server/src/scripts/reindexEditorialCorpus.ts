import { reindexEditorialCorpus } from "../lib/ai/editorialIndex";
import { logger } from "../lib/logger";

// Operational entry point for the editorial corpus indexer (#262).
// Run with:
//   pnpm --filter @workspace/api-server exec tsx src/scripts/reindexEditorialCorpus.ts

async function main() {
  const result = await reindexEditorialCorpus();
  logger.info(result, "Editorial corpus reindex complete");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Editorial corpus reindex failed");
  process.exit(1);
});
