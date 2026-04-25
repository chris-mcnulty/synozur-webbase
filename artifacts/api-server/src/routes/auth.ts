import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
} from "@workspace/db";
import { requireAuth, loadUserById } from "../middlewares/auth";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  exchangeCodeForTokens,
  generatePkcePair,
  generateRandomToken,
  isEntraConfigured,
  normalizeIdentity,
  postLogoutRedirectUri,
  redirectUri,
  verifyIdToken,
} from "../lib/entraOidc";
import {
  consumeAuthPendingState,
  persistAuthPendingState,
} from "../lib/authStateStore";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionToken,
  setSessionCookie,
} from "../lib/sessions";
import { applyEntraSignIn } from "../lib/entra";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SignInQuery = z.object({
  returnTo: z.string().max(2048).optional(),
});

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 1000) : null;
}

// `returnTo` is open-redirect-prone if we trust it blindly. Allow only same-
// origin paths and explicit allow-listed external URLs.
function safeReturnTo(returnTo: string | null | undefined, fallback: string): string {
  if (!returnTo) return fallback;
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

// GET /api/auth/sign-in — kicks off OIDC. Issues PKCE + nonce, persists the
// pending state, and 302s the browser to Entra's authorize endpoint.
router.get("/auth/sign-in", async (req, res): Promise<void> => {
  const parsed = SignInQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isEntraConfigured()) {
    res.status(503).json({
      error: "Sign-in not configured. Set ENTRA_TENANT_ID, ENTRA_APP_CLIENT_ID, AUTH_REDIRECT_URI.",
    });
    return;
  }
  const state = generateRandomToken(24);
  const nonce = generateRandomToken(24);
  const pkce = generatePkcePair();
  await persistAuthPendingState({
    state,
    codeVerifier: pkce.verifier,
    nonce,
    returnTo: safeReturnTo(parsed.data.returnTo, "/admin"),
  });
  const url = await buildAuthorizeUrl({
    state,
    nonce,
    pkceChallenge: pkce.challenge,
  });
  res.redirect(url);
});

// GET /api/auth/callback — Entra returns the user here with `code` + `state`.
// We exchange the code, validate the ID token, upsert the user row, hand off
// to applyEntraSignIn for group reconciliation, mint a session, set the
// cookie, and redirect back into the app.
const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

router.get("/auth/callback", async (req, res): Promise<void> => {
  const parsed = CallbackQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.error) {
    logger.warn(
      { error: parsed.data.error, description: parsed.data.error_description },
      "Entra OIDC callback returned error",
    );
    res.redirect("/?auth_error=" + encodeURIComponent(parsed.data.error));
    return;
  }
  if (!parsed.data.code || !parsed.data.state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }
  const pending = await consumeAuthPendingState(parsed.data.state);
  if (!pending) {
    res.status(400).json({ error: "Invalid or expired auth state" });
    return;
  }

  let identity;
  let idTokenRaw: string;
  try {
    const tokens = await exchangeCodeForTokens({
      code: parsed.data.code,
      codeVerifier: pending.codeVerifier,
    });
    const verified = await verifyIdToken(tokens.idToken, pending.nonce);
    identity = normalizeIdentity(verified.claims);
    idTokenRaw = verified.raw;
  } catch (err) {
    logger.warn({ err }, "Entra token exchange / id_token verification failed");
    res.status(401).json({ error: "Authentication failed" });
    return;
  }

  // Upsert by (authProvider, externalSubject); fall back to email match if a
  // pre-existing row was seeded without an externalSubject (e.g. by the
  // imported-author bootstrap script).
  let userRow = await db.query.usersTable.findFirst({
    where: eq(usersTable.externalSubject, identity.externalSubject),
  });
  if (!userRow && identity.email) {
    const byEmail = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, identity.email),
    });
    if (byEmail && (!byEmail.externalSubject || byEmail.authProvider === "imported")) {
      userRow = byEmail;
    }
  }
  if (userRow) {
    await db
      .update(usersTable)
      .set({
        externalSubject: identity.externalSubject,
        authProvider: "entra",
        email: identity.email ?? userRow.email,
        displayName: identity.displayName ?? userRow.displayName,
        avatarUrl: identity.avatarUrl ?? userRow.avatarUrl,
        entraTenantId: identity.entraTenantId ?? userRow.entraTenantId,
        entraObjectId: identity.entraObjectId ?? userRow.entraObjectId,
        lastSsoProvider: "entra",
        lastSignInAt: new Date(),
      })
      .where(eq(usersTable.id, userRow.id));
  } else {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        externalSubject: identity.externalSubject,
        authProvider: "entra",
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        entraTenantId: identity.entraTenantId,
        entraObjectId: identity.entraObjectId,
        lastSsoProvider: "entra",
        lastSignInAt: new Date(),
      })
      .returning();
    userRow = inserted;
    // Bootstrap: first user becomes admin.
    const userCount = await db.$count(usersTable);
    if (userCount === 1) {
      const adminRole = await db.query.rolesTable.findFirst({
        where: eq(rolesTable.name, "admin"),
      });
      if (adminRole) {
        await db
          .insert(userRoles)
          .values({ userId: userRow.id, roleId: adminRole.id })
          .onConflictDoNothing();
      }
    }
  }

  // Auto-restore admin role if listed in ADMIN_EMAILS.
  const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (
    adminEmails.length > 0 &&
    userRow.email &&
    adminEmails.includes(userRow.email.toLowerCase())
  ) {
    const adminRole = await db.query.rolesTable.findFirst({
      where: eq(rolesTable.name, "admin"),
    });
    if (adminRole) {
      await db
        .insert(userRoles)
        .values({ userId: userRow.id, roleId: adminRole.id })
        .onConflictDoNothing();
    }
  }

  // #126: refresh transitive group membership and reconcile roles.
  try {
    await applyEntraSignIn({
      userId: userRow.id,
      tenantId: identity.entraTenantId,
      objectId: identity.entraObjectId,
    });
  } catch (err) {
    logger.warn({ err, userId: userRow.id }, "applyEntraSignIn failed");
  }

  const session = await createSession({
    userId: userRow.id,
    userAgent: userAgent(req),
    ip: clientIp(req),
  });
  setSessionCookie(req, res, session.token, session.expiresAt);

  // Stash the id_token under a non-HttpOnly hint cookie? No — id_token is
  // sensitive. We keep it server-side; for RP-initiated logout we re-mint
  // the request without an id_token_hint (Entra accepts that).
  void idTokenRaw;

  const target = safeReturnTo(pending.returnTo, "/admin");
  res.redirect(target);
});

// POST /api/auth/sign-out — destroys the local session and redirects to Entra
// RP-initiated logout. Falls back to a local redirect when Entra is
// unconfigured (dev).
router.post("/auth/sign-out", async (req, res): Promise<void> => {
  const token = readSessionToken(req);
  if (token) {
    await destroySession(token);
  }
  clearSessionCookie(req, res);
  const logoutUrl = buildLogoutUrl({
    postLogoutRedirectUri: postLogoutRedirectUri() ?? null,
  });
  if (logoutUrl) {
    res.json({ ok: true, redirect: logoutUrl });
    return;
  }
  res.json({ ok: true, redirect: "/" });
});

// GET /api/auth/me — returns the current user (or 401). Used by the SPA's
// admin gate and any per-page personalization.
router.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.authedUser);
});

// Lightweight "am I signed in?" probe used by the public site's "Sign in"
// button. Returns 200 with `{ signedIn: false }` rather than 401 so the
// front-end doesn't have to special-case anonymous visits.
router.get("/auth/session", async (req, res): Promise<void> => {
  if (!req.authedUser) {
    res.json({ signedIn: false });
    return;
  }
  res.json({ signedIn: true, user: req.authedUser });
});

// Convenience: the SPA needs to know whether sign-in is configured at all
// (so it can show "Sign in with Microsoft" vs. a "contact your admin" hint).
router.get("/auth/config", (_req, res) => {
  res.json({
    entraConfigured: isEntraConfigured(),
    redirectUri: redirectUri(),
  });
});

// Dev-only escape hatch: load a user by email if the request comes from
// localhost AND `ALLOW_DEV_LOGIN=1`. Lets the team work on the admin without
// an Entra tenant. The bypass is wholly inert in any real deployment.
if (process.env["ALLOW_DEV_LOGIN"] === "1" && process.env["NODE_ENV"] !== "production") {
  const DevLoginBody = z.object({ email: z.string().email() });
  router.post("/auth/dev-login", async (req, res): Promise<void> => {
    const parsed = DevLoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const ip = clientIp(req);
    if (ip && ip !== "127.0.0.1" && ip !== "::1") {
      res.status(403).json({ error: "Dev login restricted to localhost" });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    let user = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, email),
    });
    if (!user) {
      const [inserted] = await db
        .insert(usersTable)
        .values({
          email,
          authProvider: "dev",
          externalSubject: `dev:${email}`,
          displayName: email,
        })
        .returning();
      user = inserted;
    }
    const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);
    if (adminEmails.includes(email)) {
      const adminRole = await db.query.rolesTable.findFirst({
        where: eq(rolesTable.name, "admin"),
      });
      if (adminRole) {
        await db
          .insert(userRoles)
          .values({ userId: user!.id, roleId: adminRole.id })
          .onConflictDoNothing();
      }
    }
    const session = await createSession({
      userId: user!.id,
      userAgent: userAgent(req),
      ip,
    });
    setSessionCookie(req, res, session.token, session.expiresAt);
    const fresh = await loadUserById(user!.id);
    res.json({ ok: true, user: fresh });
  });
}

export default router;
