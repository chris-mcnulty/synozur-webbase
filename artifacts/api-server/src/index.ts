import app from "./app";
import { logger } from "./lib/logger";
import { startScheduledPublishWorker } from "./lib/scheduler";
import { startHubspotWorker, stopHubspotWorker } from "./lib/hubspotSync";

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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

const worker = startScheduledPublishWorker(logger);
startHubspotWorker();

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  worker.stop();
  stopHubspotWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
