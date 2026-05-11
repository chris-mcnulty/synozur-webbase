import app from "./app";
import { logger } from "./lib/logger";
import { startScheduledPublishWorker } from "./lib/scheduler";
import { startRevisionRetentionWorker } from "./lib/revisionRetention";
import { startHubspotWorker, stopHubspotWorker, bootstrapHubspotOnStartup } from "./lib/hubspotSync";
import { pruneExpiredSessions } from "./lib/sessions";
import { pruneExpiredAuthStates } from "./lib/authStateStore";
import { warnIfMisconfigured } from "./lib/entraOidc";
import { runMigrations } from "./lib/migrations";
import { ensureSigningKey } from "./lib/oauthKeys";
import { ensureGalaxyOAuthClient } from "./lib/galaxyOauthSeed";
import { logSecurityHeaderConfig } from "./lib/securityHeaders";
import { logLaunchReadiness } from "./lib/launchReadiness";
import { seedTestAdminIfConfigured } from "./lib/testAdminSeed";
import { seedLandingPagesIfMissing } from "./lib/landingPagesSeed";

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

try {
  await runMigrations();
} catch (err) {
  logger.error({ err }, "Startup migration failed — server will continue but some features may not work");
}
await ensureSigningKey();
await ensureGalaxyOAuthClient();
await seedTestAdminIfConfigured();
await seedLandingPagesIfMissing();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

const worker = startScheduledPublishWorker(logger);
const retentionWorker = startRevisionRetentionWorker(logger);
startHubspotWorker();
// #131 — On first deploy / launch, register custom HubSpot properties +
// timeline-event templates and enqueue the historical form_submissions
// backlog. Both calls are idempotent and gated on `hubspotEnabled`.
void bootstrapHubspotOnStartup();
warnIfMisconfigured();
logSecurityHeaderConfig();
void logLaunchReadiness();

// Hourly GC: clean expired sessions + abandoned OAuth state rows.
const sessionGc = setInterval(() => {
  void pruneExpiredSessions();
  void pruneExpiredAuthStates();
}, 60 * 60 * 1000);
sessionGc.unref();

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  worker.stop();
  retentionWorker.stop();
  stopHubspotWorker();
  clearInterval(sessionGc);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
