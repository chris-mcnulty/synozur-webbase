/**
 * OAuth signing-key management — #128.
 *
 * Owns the lifecycle of RS256 key pairs used to sign access + ID tokens
 * issued by this site as an OAuth provider. Keys live in `oauth_signing_keys`
 * with the private half encrypted at rest when `OAUTH_KEK` is configured.
 *
 * On startup we ensure at least one active key exists. JWKS publishes every
 * non-retired row so consumers can verify tokens during a rotation window.
 *
 * KEK encryption format (column `private_key_material`):
 *   "kek-aes-256-gcm:<base64-iv>:<base64-tag>:<base64-ciphertext>"
 *
 * Plaintext fallback (when OAUTH_KEK is unset — dev only):
 *   the PEM bytes verbatim, with `encryption_method = 'plaintext'`.
 */

import { randomBytes, createCipheriv, createDecipheriv, generateKeyPairSync, randomUUID } from "crypto";
import { eq, isNull } from "drizzle-orm";
import { db, oauthSigningKeysTable, type OAuthSigningKey } from "@workspace/db";
import { logger } from "./logger";

const KEK_METHOD = "kek-aes-256-gcm" as const;
const PLAINTEXT_METHOD = "plaintext" as const;
const ALGORITHM = "RS256" as const;
const KEY_BITS = 2048;

let kekWarningEmitted = false;

function loadKek(): Buffer | null {
  const raw = process.env["OAUTH_KEK"];
  if (!raw) {
    if (!kekWarningEmitted) {
      logger.warn(
        "OAUTH_KEK is not set — OAuth private keys will be stored unencrypted. " +
          "Configure a base64-encoded 32-byte key in production.",
      );
      kekWarningEmitted = true;
    }
    return null;
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("OAUTH_KEK must be base64-encoded");
  }
  if (buf.length !== 32) {
    throw new Error(
      `OAUTH_KEK must decode to exactly 32 bytes (got ${buf.length}); generate with \`openssl rand -base64 32\``,
    );
  }
  return buf;
}

function encryptPrivatePem(pem: string): { material: string; method: string } {
  const kek = loadKek();
  if (!kek) {
    return { material: pem, method: PLAINTEXT_METHOD };
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const material = [
    KEK_METHOD,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
  return { material, method: KEK_METHOD };
}

function decryptPrivatePem(row: Pick<OAuthSigningKey, "privateKeyMaterial" | "encryptionMethod">): string {
  if (row.encryptionMethod === PLAINTEXT_METHOD) {
    return row.privateKeyMaterial;
  }
  if (row.encryptionMethod !== KEK_METHOD) {
    throw new Error(`Unknown OAuth signing-key encryption method: ${row.encryptionMethod}`);
  }
  const kek = loadKek();
  if (!kek) {
    throw new Error(
      "OAuth signing key was stored encrypted but OAUTH_KEK is not set; cannot decrypt.",
    );
  }
  const parts = row.privateKeyMaterial.split(":");
  if (parts.length !== 4 || parts[0] !== KEK_METHOD) {
    throw new Error("Malformed encrypted OAuth signing-key material");
  }
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const ciphertext = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export interface ActiveSigningKey {
  kid: string;
  algorithm: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generate a new RS256 key pair and insert it as the active signing key.
 * Any previously-active row is left in place but flipped to `is_active = false`
 * so its public half is still published in JWKS during the rotation window.
 */
export async function generateAndStoreSigningKey(): Promise<ActiveSigningKey> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: KEY_BITS,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const kid = randomUUID();
  const { material, method } = encryptPrivatePem(privateKey);

  await db.transaction(async (tx) => {
    await tx
      .update(oauthSigningKeysTable)
      .set({ isActive: false, rotatedAt: new Date() })
      .where(eq(oauthSigningKeysTable.isActive, true));
    await tx.insert(oauthSigningKeysTable).values({
      kid,
      algorithm: ALGORITHM,
      publicKeyPem: publicKey,
      privateKeyMaterial: material,
      encryptionMethod: method,
      isActive: true,
    });
  });

  logger.info({ kid, encryptionMethod: method }, "Generated new OAuth signing key");
  return { kid, algorithm: ALGORITHM, publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/**
 * Ensure at least one active signing key exists. Idempotent — safe to call on
 * every server startup.
 */
export async function ensureSigningKey(): Promise<void> {
  const [existing] = await db
    .select()
    .from(oauthSigningKeysTable)
    .where(eq(oauthSigningKeysTable.isActive, true))
    .limit(1);
  if (existing) return;
  await generateAndStoreSigningKey();
}

/**
 * Return the currently-active signing key with the private half decrypted.
 * Throws if no active key exists — call `ensureSigningKey()` at startup.
 */
export async function getActiveSigningKey(): Promise<ActiveSigningKey> {
  const [row] = await db
    .select()
    .from(oauthSigningKeysTable)
    .where(eq(oauthSigningKeysTable.isActive, true))
    .limit(1);
  if (!row) {
    throw new Error("No active OAuth signing key found; call ensureSigningKey() at startup.");
  }
  return {
    kid: row.kid,
    algorithm: row.algorithm,
    publicKeyPem: row.publicKeyPem,
    privateKeyPem: decryptPrivatePem(row),
  };
}

export interface PublishedKey {
  kid: string;
  algorithm: string;
  publicKeyPem: string;
}

/**
 * Return every signing key whose `retired_at` is unset — i.e. every key whose
 * tokens may still be in circulation. JWKS publishes this set so verifiers
 * can pick the right key by `kid` during a rotation window.
 */
export async function getPublishedKeys(): Promise<PublishedKey[]> {
  const rows = await db
    .select({
      kid: oauthSigningKeysTable.kid,
      algorithm: oauthSigningKeysTable.algorithm,
      publicKeyPem: oauthSigningKeysTable.publicKeyPem,
    })
    .from(oauthSigningKeysTable)
    .where(isNull(oauthSigningKeysTable.retiredAt));
  return rows;
}
