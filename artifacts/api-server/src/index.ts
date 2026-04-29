import app from "./app";
import { logger } from "./lib/logger";
import { startScheduledPublishWorker } from "./lib/scheduler";
import { startHubspotWorker, stopHubspotWorker } from "./lib/hubspotSync";
import { pruneExpiredSessions } from "./lib/sessions";
import { pruneExpiredAuthStates } from "./lib/authStateStore";
import { warnIfMisconfigured } from "./lib/entraOidc";
import { runMigrations } from "./lib/migrations";
import { ensureSigningKey } from "./lib/oauthKeys";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await runMigrations();
await ensureSigningKey();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

const worker = startScheduledPublishWorker(logger);
startHubspotWorker();
warnIfMisconfigured();

// Hourly GC: clean expired sessions + abandoned OAuth state rows.
const sessionGc = setInterval(() => {
  void pruneExpiredSessions();
  void pruneExpiredAuthStates();
}, 60 * 60 * 1000);
sessionGc.unref();

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  worker.stop();
  stopHubspotWorker();
  clearInterval(sessionGc);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
