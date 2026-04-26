/**
 * Subprocess harness for sessions.test.ts.
 *
 * Loads `sessions.ts` in a fresh process so the IDLE_TIMEOUT_MS env override
 * is captured at module load. Reads a session token from argv, calls
 * resolveSession(), and prints `null` or `valid` to stdout.
 */
import { resolveSession } from "./sessions";
import { pool } from "@workspace/db";

async function main(): Promise<void> {
  const token = process.argv[2];
  if (!token) {
    console.error("usage: idleHarness <session-token>");
    process.exit(2);
  }
  try {
    const resolved = await resolveSession(token);
    console.log(resolved === null ? "null" : "valid");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
