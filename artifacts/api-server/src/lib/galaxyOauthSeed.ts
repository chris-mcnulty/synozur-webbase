/**
 * Seed the Galaxy customer-portal SPA as an OAuth public client (#128).
 *
 * Galaxy is a browser SPA, so it authenticates by `client_id` alone with
 * PKCE on the authorization code. The client_id is a stable, well-known
 * value (`galaxy-portal-spa`) hardcoded into the Galaxy build — there is
 * no usable client_secret for a public client, but the schema's
 * `client_secret_hash` column is non-null, so we store an unguessable
 * random hash that is never honored (token endpoint short-circuits public
 * clients before checking the secret).
 *
 * The redirect URI is derived from `siteOrigin()` so dev (Replit preview),
 * production, and PR previews all just work — the seeder upserts the
 * redirect list every boot, ensuring an env switch doesn't lock Galaxy
 * out without an admin re-edit.
 */

import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, oauthClientsTable } from "@workspace/db";
import { siteOrigin } from "./siteOrigin";
import { logger } from "./logger";

export const GALAXY_CLIENT_ID = "galaxy-portal-spa";
export const GALAXY_BASE_PATH = "/galaxy";
export const GALAXY_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
];

function galaxyRedirectUris(): string[] {
  const origin = siteOrigin();
  return [`${origin}${GALAXY_BASE_PATH}/oauth-callback`];
}

export async function ensureGalaxyOAuthClient(): Promise<void> {
  const redirectUris = galaxyRedirectUris();
  const [existing] = await db
    .select()
    .from(oauthClientsTable)
    .where(eq(oauthClientsTable.clientId, GALAXY_CLIENT_ID))
    .limit(1);

  if (!existing) {
    // Random hash for a secret the client will never present; bcrypt of 32
    // random bytes so the row passes the not-null constraint without leaking
    // any usable credential.
    const placeholderSecret = randomBytes(32).toString("base64url");
    const placeholderHash = await bcrypt.hash(placeholderSecret, 10);
    await db.insert(oauthClientsTable).values({
      clientId: GALAXY_CLIENT_ID,
      clientSecretHash: placeholderHash,
      name: "Galaxy customer portal",
      description:
        "Browser SPA for Synozur customers. Public PKCE-only OAuth client.",
      redirectUris,
      allowedScopes: GALAXY_OAUTH_SCOPES,
      allowedGrantTypes: ["authorization_code", "refresh_token"],
      pkceRequired: true,
      isPublic: true,
      isActive: true,
    });
    logger.info(
      { clientId: GALAXY_CLIENT_ID, redirectUris },
      "Seeded Galaxy OAuth client",
    );
    return;
  }

  // Keep the redirect URIs / scopes in sync with what the seed expects so
  // operators don't have to re-edit the row every time the deployment
  // origin changes.
  const desired = JSON.stringify(redirectUris.slice().sort());
  const current = JSON.stringify(
    (existing.redirectUris ?? []).slice().sort(),
  );
  const desiredScopes = JSON.stringify(GALAXY_OAUTH_SCOPES.slice().sort());
  const currentScopes = JSON.stringify(
    (existing.allowedScopes ?? []).slice().sort(),
  );
  if (
    desired !== current ||
    desiredScopes !== currentScopes ||
    !existing.isPublic ||
    !existing.pkceRequired ||
    !existing.isActive
  ) {
    await db
      .update(oauthClientsTable)
      .set({
        redirectUris,
        allowedScopes: GALAXY_OAUTH_SCOPES,
        isPublic: true,
        pkceRequired: true,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(oauthClientsTable.id, existing.id));
    logger.info(
      { clientId: GALAXY_CLIENT_ID, redirectUris },
      "Refreshed Galaxy OAuth client redirect URIs",
    );
  }
}
