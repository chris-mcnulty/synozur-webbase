import { Router, type IRouter } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { z } from "zod";
import { CreateSharedOrganizationAccountBody, RotateSharedOrganizationAccountBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";
import individualAuthRouter from "./auth";
import { activeOrg, requirePrivateStaff, uuid } from "../lib/privatePages/access";
import {
  confidentialHeaders, digest, generateSharedPassword, privateWriteGuard,
  setSharedCookie, SHARED_COOKIE, SHARED_TTL_MS,
} from "../lib/privatePages/sharedAccess";

const router: IRouter = Router();
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._@+-]{2,127}$/);
const credentials = z.object({ username, password: z.string().min(1).max(128) }).strict();
const chosenPassword = z.string().min(15).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72);
const accountBody = CreateSharedOrganizationAccountBody.extend({ username, password: chosenPassword.optional() }).strict();
const passwordBody = RotateSharedOrganizationAccountBody.extend({ password: chosenPassword.optional() }).strict();
// Same work factor for unknown users; generated in memory, never a credential.
const dummyHash = bcrypt.hashSync(randomBytes(24).toString("base64url"), 12);
const prefix = "/admin/private-pages/:orgId/accounts";

// One credential form; account lookup stays server-side. Shared identities
// retain their own cookie, limits and restricted authorization.
router.post("/auth/galaxy/login", confidentialHeaders, privateWriteGuard, async (req, res, next) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) { res.status(401).json({ error: "Invalid username or password." }); return; }
  const result = await pool.query("SELECT id FROM shared_organization_accounts WHERE username=$1", [parsed.data.username]);
  const originalUrl = req.url;
  const shared = result.rowCount !== 0;
  req.url = shared ? "/auth/shared/login" : "/auth/login";
  req.body = shared ? parsed.data : { email: parsed.data.username, password: parsed.data.password };
  const target = shared ? router : individualAuthRouter;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (!shared) setSharedCookie(req, res, null);
      return json({ ok: true, accountType: shared ? "shared" : "individual" });
    }
    if (res.statusCode === 401 || res.statusCode === 400) {
      res.status(401);
      return json({ error: "Invalid email, username or password." });
    }
    return json(body);
  };
  target(req, res, (error?: unknown) => { req.url = originalUrl; next(error); });
});

router.use("/auth/shared", confidentialHeaders);
router.use("/admin/private-pages", confidentialHeaders);
router.get("/auth/shared/session", (req, res) => {
  const user = req.authedUser?.authProvider === "shared_org" ? req.authedUser : null;
  res.json({ signedIn: !!user, user });
});

router.post("/auth/shared/login", privateWriteGuard, async (req, res): Promise<void> => {
  const parsed = credentials.safeParse(req.body);
  const normalized = parsed.success ? parsed.data.username : String(req.body?.username ?? "").trim().toLowerCase().slice(0, 128);
  // Durable counters survive process restarts and multiple instances.
  // Use both IP and username; no plaintext names/IPs stored in throttle rows.
  let throttled = false;
  for (const [bucket, limit] of [[`ip:${req.ip}`, 40], [`account:${normalized}`, 10]] as const) {
    const result = await pool.query(`
      INSERT INTO shared_login_attempts(bucket_hash,attempts,expires_at)
      VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(bucket_hash) DO UPDATE SET
        attempts=CASE WHEN shared_login_attempts.expires_at<now() THEN 1 ELSE shared_login_attempts.attempts+1 END,
        expires_at=CASE WHEN shared_login_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE shared_login_attempts.expires_at END
      RETURNING attempts
    `, [digest(bucket)]);
    if (result.rows[0].attempts > limit) throttled = true;
  }
  if (throttled) {
    res.set("Retry-After", "900").status(429).json({ error: "Unable to sign in. Try again later." }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT a.* FROM shared_organization_accounts a
      JOIN client_organizations o ON o.id=a.organization_id
      JOIN users u ON u.id=a.user_id AND u.client_organization_id=a.organization_id
      JOIN client_organization_users m ON m.user_id=a.user_id AND m.client_organization_id=a.organization_id
      WHERE a.username=$1 AND NOT a.disabled AND o.is_active AND o.deleted_at IS NULL
        AND u.auth_provider='shared_org' FOR UPDATE OF a
    `, [normalized]);
    const account = result.rows[0];
    const valid = await bcrypt.compare(parsed.success ? parsed.data.password : "", account?.password_hash ?? dummyHash);
    if (!parsed.success || !account || !valid) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "Invalid username or password." }); return;
    }
    const token = randomBytes(32).toString("base64url");
    // Replace only the caller's previous shared session, never other recipients.
    const previous = req.cookies?.[SHARED_COOKIE];
    if (previous) await client.query("DELETE FROM shared_organization_sessions WHERE token_hash=$1", [digest(String(previous))]);
    await client.query(`
      INSERT INTO shared_organization_sessions(token_hash,account_id,credential_version,expires_at)
      VALUES($1,$2,$3,$4)
    `, [digest(token), account.id, account.credential_version, new Date(Date.now() + SHARED_TTL_MS)]);
    await client.query("UPDATE users SET last_sign_in_at=now() WHERE id=$1", [account.user_id]);
    // Successful recipients do not consume the failure allowance of everyone
    // else using the organization's shared login.
    await client.query(`
      UPDATE shared_login_attempts SET attempts=GREATEST(attempts-1,0)
      WHERE bucket_hash=ANY($1::text[])
    `, [[digest(`ip:${req.ip}`), digest(`account:${normalized}`)]]);
    await client.query("DELETE FROM shared_login_attempts WHERE expires_at<now()");
    await client.query("COMMIT");
    setSharedCookie(req, res, token);
    await audit({ actorId: account.user_id, action: "shared_account.sign_in", entity: "shared_account", entityId: account.id });
    res.json({ ok: true });
  } catch {
    await client.query("ROLLBACK");
    res.status(503).json({ error: "Sign-in unavailable. Try again later." });
  } finally { client.release(); }
});

router.post("/auth/shared/logout", privateWriteGuard, async (req, res): Promise<void> => {
  const token = req.cookies?.[SHARED_COOKIE];
  if (token) await pool.query("DELETE FROM shared_organization_sessions WHERE token_hash=$1", [digest(String(token))]);
  setSharedCookie(req, res, null);
  res.json({ ok: true });
});

router.get(prefix, requirePrivateStaff, async (req, res): Promise<void> => {
  const orgId = String(req.params.orgId);
  if (!(await activeOrg(orgId))) { res.status(404).json({ error: "Not found" }); return; }
  const result = await pool.query("SELECT id,username,disabled FROM shared_organization_accounts WHERE organization_id=$1 ORDER BY username", [orgId]);
  res.json({ items: result.rows });
});

router.post(prefix, requirePrivateStaff, privateWriteGuard, async (req, res): Promise<void> => {
  const orgId = String(req.params.orgId);
  const parsed = accountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Use a valid username. A custom password must contain at least 15 characters and at most 72 UTF-8 bytes, or omit it to generate one." }); return; }
  if (!(await activeOrg(orgId))) { res.status(404).json({ error: "Not found" }); return; }
  const password = parsed.data.password ?? generateSharedPassword();
  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  const userId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users(id,auth_provider,display_name,client_organization_id) VALUES($1,'shared_org',$2,$3)", [userId, parsed.data.username, orgId]);
    const result = await client.query(`
      INSERT INTO shared_organization_accounts(user_id,organization_id,username,password_hash,disabled,created_by)
      VALUES($1,$2,$3,$4,false,$5) RETURNING id,username,disabled
    `, [userId, orgId, parsed.data.username, hash, req.authedUser!.id]);
    await client.query("INSERT INTO client_organization_users(user_id,client_organization_id,role) VALUES($1,$2,'member')", [userId, orgId]);
    await client.query("COMMIT");
    await audit({ actorId: req.authedUser!.id, action: "shared_account.create", entity: "shared_account", entityId: result.rows[0].id });
    res.status(201).json({ account: result.rows[0], password });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status((error as { code?: string }).code === "23505" ? 409 : 503)
      .json({ error: "Unable to create shared account. The username may already be taken." });
  } finally { client.release(); }
});

router.post(`${prefix}/:id/:action`, requirePrivateStaff, privateWriteGuard, async (req, res): Promise<void> => {
  const orgId = String(req.params.orgId), id = String(req.params.id), action = String(req.params.action);
  if (!uuid.safeParse(orgId).success || !uuid.safeParse(id).success || !["rotate", "disable"].includes(action)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  const parsedPassword = passwordBody.safeParse(req.body ?? {});
  if (action === "rotate" && !parsedPassword.success) {
    res.status(400).json({ error: "A custom password must contain at least 15 characters and at most 72 UTF-8 bytes, or omit it to generate one." }); return;
  }
  const password = action === "rotate" ? (parsedPassword.success ? parsedPassword.data.password : undefined) ?? generateSharedPassword() : null;
  const hash = password ? await bcrypt.hash(password, 12) : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT * FROM shared_organization_accounts WHERE id=$1 AND organization_id=$2 FOR UPDATE
    `, [id, orgId]);
    const account = result.rows[0];
    if (!account) { await client.query("ROLLBACK"); res.status(404).json({ error: "Not found" }); return; }
    await client.query(`
      UPDATE shared_organization_accounts SET credential_version=credential_version+1,
        disabled=$2,password_hash=COALESCE($3,password_hash),password_rotated_at=now(),updated_at=now() WHERE id=$1
    `, [id, action === "disable", hash]);
    await client.query("DELETE FROM shared_organization_sessions WHERE account_id=$1", [id]);
    // Defense in depth: remove any legacy or erroneously provisioned grants.
    for (const table of ["sessions", "oauth_refresh_tokens", "oauth_authorization_codes", "password_reset_tokens", "email_verification_tokens"]) {
      await client.query(`DELETE FROM ${table} WHERE user_id=$1`, [account.user_id]);
    }
    await client.query("COMMIT");
    await audit({ actorId: req.authedUser!.id, action: `shared_account.${action}`, entity: "shared_account", entityId: id });
    res.json(password ? { account: { id, username: account.username, disabled: false }, password } : { ok: true });
  } catch {
    await client.query("ROLLBACK");
    res.status(503).json({ error: "Unable to update shared account." });
  } finally { client.release(); }
});

export default router;
