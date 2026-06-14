/**
 * Admin CRUD for API keys — machine-to-machine access.
 *
 * Keys carry `syn_` prefix + 40 hex chars of entropy. The SHA-256 hash is
 * stored at rest; the plaintext is returned exactly once at creation and
 * never again. Each key is scoped to a set of capabilities that slot into
 * the existing requireCapability() checks without changes to route handlers.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { db, apiKeysTable, CAPABILITY_NAMES, type CapabilityName } from "@workspace/db";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import { audit } from "../../lib/audit";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEY_PREFIX = "syn_";
const KEY_RANDOM_HEX_BYTES = 20; // 40 hex chars

function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = randomBytes(KEY_RANDOM_HEX_BYTES).toString("hex");
  const plaintext = `${KEY_PREFIX}${random}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = random.slice(0, 8);
  return { plaintext, hash, prefix };
}

const CapabilityList = z.array(
  z.enum(CAPABILITY_NAMES as readonly [CapabilityName, ...CapabilityName[]]),
);

function rowToDto(row: typeof apiKeysTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prefix: row.prefix,
    grantedCapabilities: row.grantedCapabilities,
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    useCount: row.useCount,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    isRevoked: row.revokedAt !== null,
    isExpired: row.expiresAt !== null && row.expiresAt < new Date(),
  };
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get(
  "/cms/api-keys",
  requireAuth,
  requireCapability("api_keys.manage"),
  async (_req, res) => {
    const rows = await db.select().from(apiKeysTable).orderBy(apiKeysTable.createdAt);
    res.json(rows.map(rowToDto));
  },
);

// ─── Get one ──────────────────────────────────────────────────────────────────

router.get(
  "/cms/api-keys/:id",
  requireAuth,
  requireCapability("api_keys.manage"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [row] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "API key not found" });
      return;
    }
    res.json(rowToDto(row));
  },
);

// ─── Create ───────────────────────────────────────────────────────────────────

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  grantedCapabilities: CapabilityList,
  expiresAt: z.string().datetime().optional(),
});

router.post(
  "/cms/api-keys",
  requireAuth,
  requireCapability("api_keys.manage"),
  async (req, res): Promise<void> => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const { plaintext, hash, prefix } = generateApiKey();

    const [inserted] = await db
      .insert(apiKeysTable)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        keyHash: hash,
        prefix,
        grantedCapabilities: Array.from(new Set(parsed.data.grantedCapabilities)),
        createdByUserId: req.authedUser!.id,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      })
      .returning();

    await audit({
      actorId: req.authedUser!.id,
      action: "api_key.created",
      entity: "api_key",
      entityId: inserted!.id,
      diff: {
        name: inserted!.name,
        prefix: inserted!.prefix,
        grantedCapabilities: inserted!.grantedCapabilities,
      },
    });

    // Plaintext is returned EXACTLY ONCE — the admin UI must surface it
    // immediately and never re-fetch.
    res.status(201).json({
      ...rowToDto(inserted!),
      // One-time plaintext reveal
      plaintext,
    });
  },
);

// ─── Revoke ───────────────────────────────────────────────────────────────────

router.delete(
  "/cms/api-keys/:id",
  requireAuth,
  requireCapability("api_keys.manage"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [existing] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "API key not found" });
      return;
    }
    if (existing.revokedAt) {
      res.status(409).json({ error: "API key already revoked" });
      return;
    }

    await db
      .update(apiKeysTable)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeysTable.id, id));

    await audit({
      actorId: req.authedUser!.id,
      action: "api_key.revoked",
      entity: "api_key",
      entityId: id,
      diff: { name: existing.name, prefix: existing.prefix },
    });

    res.status(204).send();
  },
);

export default router;
