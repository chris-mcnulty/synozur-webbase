import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep TCP connections alive so the server doesn't silently drop idle
  // connections. Without this, production pools that are quiet for >10 min
  // get their connections killed at the TCP level, and the next query hangs
  // until the OS-level keepalive detects the failure (~minutes).
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Retire idle connections after 5 minutes — shorter than the Replit/PG
  // server's own idle timeout so we always close gracefully rather than
  // getting surprised by a dead socket mid-query.
  idleTimeoutMillis: 5 * 60 * 1000,
  // Fail fast on connection acquisition so callers get a clear error rather
  // than hanging for 60 s waiting for a reconnect.
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
