/**
 * Admin CRUD for OAuth client registrations — #128 Phase A.
 *
 * Surfaces the `oauth_clients` table to admins under /api/cms/oauth/clients.
 * The plaintext client secret is returned exactly once — at create time and
 * on rotate-secret — and never persisted. We store a bcrypt hash so a DB leak
 * doesn't yield usable credentials.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, oauthClientsTable, oauthRefreshTokensTable } from "@workspace/db";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import { audit } from "../../lib/audit";

const router: IRouter = Router();

const BCRYPT_ROUNDS = 12;

// Allowed grant-type vocabulary. Anything else is rejected at the API layer
// rather than via a DB constraint so we can grow the set without a migration.
// Note: `client_credentials` is omitted — it isn't implemented in the token
// endpoint yet and advertising it would let admins create non-functional clients.
const ALLOWED_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
] as const;

// Initial scope vocabulary (Phase C will expand this with per-app role
// management scopes). Kept as a hard-coded allow-list so the admin UI shows
// only known values; clients may not be granted scopes outside this set.
const ALLOWED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "content.read",
  "content.write",
  "engagements.read",
  "deliverables.read",
  "invoices.read",
] as const;

function generateClientId(): string {
  // 16 bytes of entropy → 22-char base64url. Prefixed so admins can spot a
  // client_id at a glance.
  return `syn_${randomBytes(16).toString("base64url")}`;
}

function generateClientSecret(): string {
  // 32 bytes of entropy → 43-char base64url.
  return randomBytes(32).toString("base64url");
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get(
  "/cms/oauth/clients",
  requireAuth,
  requireCapability("oauth.manage"),
  async (_req, res) => {
    const rows = await db.select().from(oauthClientsTable);
    res.json(
      rows
        .map((c) => ({
          id: c.id,
          clientId: c.clientId,
          name: c.name,
          description: c.description,
          redirectUris: c.redirectUris,
          allowedScopes: c.allowedScopes,
          allowedGrantTypes: c.allowedGrantTypes,
          pkceRequired: c.pkceRequired,
          isPublic: c.isPublic,
          isActive: c.isActive,
          lastUsedAt: c.lastUsedAt,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  },
);

// ─── Get one ──────────────────────────────────────────────────────────────────

router.get(
  "/cms/oauth/clients/:id",
  requireAuth,
  requireCapability("oauth.manage"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [row] = await db
      .select()
      .from(oauthClientsTable)
      .where(eq(oauthClientsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "OAuth client not found" });
      return;
    }
    res.json({
      id: row.id,
      clientId: row.clientId,
      name: row.name,
      description: row.description,
      redirectUris: row.redirectUris,
      allowedScopes: row.allowedScopes,
      allowedGrantTypes: row.allowedGrantTypes,
      pkceRequired: row.pkceRequired,
      isPublic: row.isPublic,
      isActive: row.isActive,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },
);

// ─── Create ───────────────────────────────────────────────────────────────────

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  redirectUris: z
    .array(z.string().url().max(2048))
    .min(1)
    .max(20),
  allowedScopes: z
    .array(z.enum(ALLOWED_SCOPES as readonly [string, ...string[]]))
    .min(1),
  allowedGrantTypes: z
    .array(z.enum(ALLOWED_GRANT_TYPES as readonly [string, ...string[]]))
    .min(1),
  pkceRequired: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

router.post(
  "/cms/oauth/clients",
  requireAuth,
  requireCapability("oauth.manage"),
  async (req, res): Promise<void> => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const clientIdPublic = generateClientId();
    const clientSecret = generateClientSecret();
    const clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS);

    const [inserted] = await db
      .insert(oauthClientsTable)
      .values({
        clientId: clientIdPublic,
        clientSecretHash,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        redirectUris: parsed.data.redirectUris,
        allowedScopes: Array.from(new Set(parsed.data.allowedScopes)),
        allowedGrantTypes: Array.from(new Set(parsed.data.allowedGrantTypes)),
        pkceRequired: parsed.data.pkceRequired ?? true,
        isPublic: parsed.data.isPublic ?? false,
        createdBy: req.authedUser!.id,
      })
      .returning();

    await audit({
      actorId: req.authedUser!.id,
      action: "oauth.client_created",
      entity: "oauth_client",
      entityId: inserted!.id,
      diff: { name: inserted!.name, clientId: inserted!.clientId },
    });

    // The plaintext secret is shown EXACTLY ONCE here — the admin UI must
    // surface it on the create response and never re-fetch.
    res.status(201).json({
      id: inserted!.id,
      clientId: inserted!.clientId,
      clientSecret,
      name: inserted!.name,
      description: inserted!.description,
      redirectUris: inserted!.redirectUris,
      allowedScopes: inserted!.allowedScopes,
      allowedGrantTypes: inserted!.allowedGrantTypes,
      pkceRequired: inserted!.pkceRequired,
      isPublic: inserted!.isPublic,
      isActive: inserted!.isActive,
      createdAt: inserted!.createdAt,
    });
  },
);

// ─── Update (everything except the secret) ────────────────────────────────────

const UpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  redirectUris: z
    .array(z.string().url().max(2048))
    .min(1)
    .max(20)
    .optional(),
  allowedScopes: z
    .array(z.enum(ALLOWED_SCOPES as readonly [string, ...string[]]))
    .min(1)
    .optional(),
  allowedGrantTypes: z
    .array(z.enum(ALLOWED_GRANT_TYPES as readonly [string, ...string[]]))
    .min(1)
    .optional(),
  pkceRequired: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  "/cms/oauth/clients/:id",
  requireAuth,
  requireCapability("oauth.manage"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const [existing] = await db
      .select()
      .from(oauthClientsTable)
      .where(eq(oauthClientsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "OAuth client not found" });
      return;
    }
    const patch: Partial<typeof oauthClientsTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.redirectUris !== undefined) patch.redirectUris = parsed.data.redirectUris;
    if (parsed.data.allowedScopes !== undefined) {
      patch.allowedScopes = Array.from(new Set(parsed.data.allowedScopes));
    }
    if (parsed.data.allowedGrantTypes !== undefined) {
      patch.allowedGrantTypes = Array.from(new Set(parsed.data.allowedGrantTypes));
    }
    if (parsed.data.pkceRequired !== undefined) patch.pkceRequired = parsed.data.pkceRequired;
    if (parsed.data.isPublic !== undefined) patch.isPublic = parsed.data.isPublic;
    if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;

    const [updated] = await db
      .update(oauthClientsTable)
      .set(patch)
      .where(eq(oauthClientsTable.id, id))
      .returning();

    await audit({
      actorId: req.authedUser!.id,
      action: "oauth.client_updated",
      entity: "oauth_client",
      entityId: id,
      diff: { changes: parsed.data },
    });

    res.json({
      id: updated!.id,
      clientId: updated!.clientId,
      name: updated!.name,
      description: updated!.description,
      redirectUris: updated!.redirectUris,
      allowedScopes: updated!.allowedScopes,
      allowedGrantTypes: updated!.allowedGrantTypes,
      pkceRequired: updated!.pkceRequired,
      isPublic: updated!.isPublic,
      isActive: updated!.isActive,
      lastUsedAt: updated!.lastUsedAt,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    });
  },
);

// ─── Rotate secret ────────────────────────────────────────────────────────────

router.post(
  "/cms/oauth/clients/:id/rotate-secret",
  requireAuth,
  requireCapability("oauth.manage"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [existing] = await db
      .select()
      .from(oauthClientsTable)
      .where(eq(oauthClientsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "OAuth client not found" });
      return;
    }
    const clientSecret = generateClientSecret();
    const clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS);
    await db
      .update(oauthClientsTable)
      .set({ clientSecretHash, updatedAt: new Date() })
      .where(eq(oauthClientsTable.id, id));

    await audit({
      actorId: req.authedUser!.id,
      action: "oauth.client_secret_rotated",
      entity: "oauth_client",
      entityId: id,
    });

    res.json({ clientId: existing.clientId, clientSecret });
  },
);

// ─── Revoke (deactivate + invalidate tokens) ──────────────────────────────────

router.post(
  "/cms/oauth/clients/:id/revoke",
  requireAuth,
  requireCapability("oauth.manage"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [existing] = await db
      .select()
      .from(oauthClientsTable)
      .where(eq(oauthClientsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "OAuth client not found" });
      return;
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(oauthClientsTable)
        .set({ isActive: false, updatedAt: now })
        .where(eq(oauthClientsTable.id, id));
      await tx
        .update(oauthRefreshTokensTable)
        .set({ revokedAt: now })
        .where(eq(oauthRefreshTokensTable.clientId, existing.clientId));
    });

    await audit({
      actorId: req.authedUser!.id,
      action: "oauth.client_revoked",
      entity: "oauth_client",
      entityId: id,
    });

    res.json({ ok: true });
  },
);

export default router;
