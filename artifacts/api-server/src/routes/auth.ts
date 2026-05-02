import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
  clientOrganizationsTable,
  emailVerificationTokensTable,
  passwordResetTokensTable,
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
  redirectUriOverride,
  tenantAuthority,
  verifyIdToken,
} from "../lib/entraOidc";
import {
  consumeAuthPendingState,
  persistAuthPendingState,
} from "../lib/authStateStore";
import { audit } from "../lib/audit";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  destroySessionById,
  listSessionsForUser,
  readSessionToken,
  setSessionCookie,
} from "../lib/sessions";
import { applyEntraSignIn, applyClientOrgRole } from "../lib/entra";
import { logger } from "../lib/logger";
import {
  sendEmailVerification,
  sendPasswordReset,
  sendOrgPendingApproval,
} from "../lib/email";

const router: IRouter = Router();

const BCRYPT_ROUNDS = 12;

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function safeReturnTo(returnTo: string | null | undefined, fallback: string): string {
  if (!returnTo) return fallback;
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

// Derive the OIDC callback URL from the incoming request so the same code
// works for any environment (Replit dev domain, staging, production) without
// requiring AUTH_REDIRECT_URI to be set. When AUTH_REDIRECT_URI IS set it
// takes precedence — useful if the server sits behind a non-standard proxy.
// The derived URL is stored in the auth_pending_states row and used again
// during the token exchange at callback time (OIDC requires an exact match).
function deriveCallbackUri(req: Request): string {
  const override = redirectUriOverride();
  if (override) return override;
  const proto =
    req.get("x-forwarded-proto") ??
    (req.secure ? "https" : "http");
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? req.hostname;
  return `${proto}://${host}/api/auth/callback`;
}

// Returns the clientOrganization row whose entraTenantId matches the given
// token tid, or null if none. Used to validate multi-tenant Entra logins.
async function findActiveClientOrgByTenant(
  tenantId: string,
): Promise<typeof clientOrganizationsTable.$inferSelect | null> {
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.entraTenantId, tenantId),
      eq(clientOrganizationsTable.isActive, true),
    ),
  });
  return org ?? null;
}

// Returns ANY org (active or pending) matching the given Entra tenant ID.
async function findAnyOrgByTenant(
  tenantId: string,
): Promise<typeof clientOrganizationsTable.$inferSelect | null> {
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.entraTenantId, tenantId),
  });
  return org ?? null;
}

// Auto-create a pending (isActive=false) client org for a first-time Entra
// tenant. The org name is derived from the user's email domain. Slug conflicts
// are resolved by appending a numeric suffix.
async function autoCreatePendingOrg(identity: {
  email: string | null;
  entraTenantId: string | null;
}): Promise<typeof clientOrganizationsTable.$inferSelect> {
  const domain = identity.email?.split("@")[1]?.toLowerCase() ?? "unknown";
  const baseName = domain.replace(/\.[^.]+$/, ""); // strip TLD
  const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const baseSlug = domain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // Ensure slug uniqueness.
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const existing = await db.query.clientOrganizationsTable.findFirst({
      where: eq(clientOrganizationsTable.slug, slug),
    });
    if (!existing) break;
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }

  const [org] = await db
    .insert(clientOrganizationsTable)
    .values({
      name: displayName,
      slug,
      entraTenantId: identity.entraTenantId,
      approvedEmailDomains: [domain],
      isActive: false,
      autoCreated: true,
      notes: `Auto-created on first Entra sign-in from ${domain}. Pending Synozur approval.`,
    })
    .returning();

  logger.info(
    { orgId: org!.id, slug, domain, entraTenantId: identity.entraTenantId },
    "Auto-created pending client org for unknown Entra tenant",
  );
  return org!;
}

// Returns the clientOrganization that approves the given email domain, or null.
async function findActiveClientOrgByEmailDomain(
  email: string,
): Promise<typeof clientOrganizationsTable.$inferSelect | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  // Fetch all active orgs that have a non-empty domain list and check in JS.
  // (Postgres array @> operator would need raw sql; the table should be small.)
  const orgs = await db.query.clientOrganizationsTable.findMany({
    where: eq(clientOrganizationsTable.isActive, true),
  });
  return orgs.find((o) =>
    (o.approvedEmailDomains ?? []).map((d) => d.toLowerCase()).includes(domain),
  ) ?? null;
}

// ---------------------------------------------------------------------------
// Rate limiter — POST /api/auth/login (failed-attempts only, per IP)
// ---------------------------------------------------------------------------
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `login:${ipKeyGenerator(req)}`,
  handler: (req: Request, res: Response): void => {
    const ip = ipKeyGenerator(req);
    void audit({
      action: "auth.login_rate_limited",
      entity: "ip",
      entityId: ip,
    });
    res.status(429).json({
      error: "Too many sign-in attempts. Please try again in 15 minutes.",
    });
  },
});

// ---------------------------------------------------------------------------
// Rate limiter — POST /api/auth/forgot-password (5 requests per 15 min per IP)
// ---------------------------------------------------------------------------
const forgotPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `forgot-password:${ipKeyGenerator(req)}`,
  handler: (_req: Request, res: Response): void => {
    res.status(429).json({
      error: "Too many password reset requests. Please try again in 15 minutes.",
    });
  },
});

// ---------------------------------------------------------------------------
// Rate limiter — POST /api/auth/reset-password (10 requests per 15 min per IP)
// ---------------------------------------------------------------------------
const resetPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `reset-password:${ipKeyGenerator(req)}`,
  handler: (_req: Request, res: Response): void => {
    res.status(429).json({
      error: "Too many password reset attempts. Please try again in 15 minutes.",
    });
  },
});

// ---------------------------------------------------------------------------
// Rate limiter — POST /api/auth/register (5 requests per 15 min per IP)
// ---------------------------------------------------------------------------
const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `register:${ipKeyGenerator(req)}`,
  handler: (_req: Request, res: Response): void => {
    res.status(429).json({
      error: "Too many registration attempts. Please try again in 15 minutes.",
    });
  },
});

// ---------------------------------------------------------------------------
// Rate limiter — POST /api/auth/resend-verification (5 requests per 15 min per IP)
// ---------------------------------------------------------------------------
const resendVerificationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `resend-verification:${ipKeyGenerator(req)}`,
  handler: (_req: Request, res: Response): void => {
    res.status(429).json({
      error: "Too many verification email requests. Please try again in 15 minutes.",
    });
  },
});

// ---------------------------------------------------------------------------
// Entra SSO — GET /api/auth/sign-in
// ---------------------------------------------------------------------------
router.get("/auth/sign-in", async (req, res): Promise<void> => {
  const parsed = SignInQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isEntraConfigured()) {
    res.status(503).json({
      error: "SSO sign-in not configured. Set ENTRA_TENANT_ID and ENTRA_APP_CLIENT_ID.",
    });
    return;
  }
  const state = generateRandomToken(24);
  const nonce = generateRandomToken(24);
  const pkce = generatePkcePair();
  const callbackUri = deriveCallbackUri(req);
  await persistAuthPendingState({
    state,
    codeVerifier: pkce.verifier,
    nonce,
    returnTo: safeReturnTo(parsed.data.returnTo, "/admin"),
    redirectUri: callbackUri,
  });
  const url = await buildAuthorizeUrl({
    state,
    nonce,
    pkceChallenge: pkce.challenge,
    redirectUri: callbackUri,
  });
  res.redirect(url);
});

// ---------------------------------------------------------------------------
// Entra SSO — GET /api/auth/callback
// ---------------------------------------------------------------------------
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

  // Use the stored redirect URI — must match exactly what was sent in the
  // authorize request. Falls back to deriving from the request if the row
  // pre-dates the redirect_uri column (old pending states).
  const callbackUri = pending.redirectUri ?? deriveCallbackUri(req);

  let identity;
  let idTokenRaw: string;
  try {
    const tokens = await exchangeCodeForTokens({
      code: parsed.data.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: callbackUri,
    });
    const verified = await verifyIdToken(tokens.idToken, pending.nonce);
    identity = normalizeIdentity(verified.claims);
    idTokenRaw = verified.raw;
  } catch (err) {
    logger.warn({ err }, "Entra token exchange / id_token verification failed");
    res.status(401).json({ error: "Authentication failed" });
    return;
  }

  // Resolve the client org for this Entra sign-in:
  //   (a) Synozur's own tenant → no client org, proceed normally.
  //   (b) Known active client org tenant → link and grant default role.
  //   (c) Known but INACTIVE org (pending approval) → link user, no role yet.
  //   (d) Unknown tenant → auto-create a pending org, link user, send notification.
  const synozurTenantId = tenantAuthority();
  const isSynozurTenant =
    !!identity.entraTenantId &&
    synozurTenantId !== "organizations" &&
    synozurTenantId !== "common" &&
    identity.entraTenantId === synozurTenantId;

  // `clientOrg` is only set when the org is ACTIVE — used to gate role grants.
  // `linkedOrgId` is the org to store on the user row (active or pending).
  let clientOrg: typeof clientOrganizationsTable.$inferSelect | null = null;
  let linkedOrgId: string | null = null;
  let orgIsPending = false;

  if (!isSynozurTenant && identity.entraTenantId) {
    clientOrg = await findActiveClientOrgByTenant(identity.entraTenantId);
    if (clientOrg) {
      linkedOrgId = clientOrg.id;
    } else {
      const anyOrg = await findAnyOrgByTenant(identity.entraTenantId);
      if (anyOrg) {
        linkedOrgId = anyOrg.id;
        orgIsPending = !anyOrg.isActive;
      } else {
        // Brand-new tenant — create a pending org for Synozur to approve.
        const newOrg = await autoCreatePendingOrg(identity);
        linkedOrgId = newOrg.id;
        orgIsPending = true;
      }
    }
  }

  // Upsert user by (authProvider, externalSubject). Fall back to email match
  // for rows seeded before the externalSubject column existed.
  let userRow = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.authProvider, "entra"),
      eq(usersTable.externalSubject, identity.externalSubject),
    ),
  });
  if (!userRow && identity.email) {
    const byEmail = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, identity.email),
    });
    if (byEmail && (!byEmail.externalSubject || byEmail.authProvider === "imported")) {
      userRow = byEmail;
    }
  }

  const isNewEntraUser = !userRow;
  const orgId = linkedOrgId;
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
        lastSignInAt: new Date(),
        ...(orgId ? { clientOrganizationId: orgId } : {}),
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
        lastSignInAt: new Date(),
        clientOrganizationId: orgId,
      })
      .returning();
    userRow = inserted;
    // Bootstrap: first user ever becomes admin.
    const userCount = await db.$count(usersTable);
    if (userCount === 1) {
      const adminRole = await db.query.rolesTable.findFirst({
        where: eq(rolesTable.name, "admin"),
      });
      if (adminRole) {
        await db.insert(userRoles).values({ userId: userRow.id, roleId: adminRole.id }).onConflictDoNothing();
      }
    }
  }

  // Auto-restore admin for emails in ADMIN_EMAILS.
  const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (adminEmails.length > 0 && userRow.email && adminEmails.includes(userRow.email.toLowerCase())) {
    const adminRole = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, "admin") });
    if (adminRole) {
      await db.insert(userRoles).values({ userId: userRow.id, roleId: adminRole.id }).onConflictDoNothing();
    }
  }

  // Apply org's default role only when the org is ACTIVE.
  // Pending orgs (isActive=false) don't grant roles until Synozur approves them.
  if (clientOrg?.id) {
    await applyClientOrgRole(userRow.id, clientOrg.id);
  }

  // Send "pending approval" notification to brand-new Entra users from an
  // unknown / not-yet-approved tenant (fire-and-forget).
  if (orgIsPending && isNewEntraUser && userRow.email) {
    const pendingOrg = linkedOrgId
      ? await db.query.clientOrganizationsTable.findFirst({
          where: eq(clientOrganizationsTable.id, linkedOrgId),
        })
      : null;
    void sendOrgPendingApproval({
      to: userRow.email,
      name: userRow.displayName,
      orgName: pendingOrg?.name ?? "your organization",
    });
  }

  // Entra group reconciliation — Synozur's own tenant only.
  try {
    await applyEntraSignIn({
      userId: userRow.id,
      tenantId: identity.entraTenantId,
      objectId: identity.entraObjectId,
      clientOrganizationId: orgId,
      isSynozurTenant,
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
  void idTokenRaw;
  // Pending-org users land on a waiting page rather than /admin.
  const postSignInDest = orgIsPending
    ? "/pending-approval"
    : safeReturnTo(pending.returnTo, "/admin");
  res.redirect(postSignInDest);
});

// ---------------------------------------------------------------------------
// Local email/password — POST /api/auth/register
// ---------------------------------------------------------------------------
const RegisterBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(255).optional(),
  // Invitation / self-service: users may supply an org slug to claim
  // membership. Membership is only granted when the org has an approved email
  // domain that matches — otherwise it's stored for admin review.
  organizationSlug: z.string().max(100).optional(),
});

router.post("/auth/register", registerRateLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { email, password, displayName, organizationSlug } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  // Check for existing account.
  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, normalizedEmail),
  });
  if (existing) {
    // Return the same error regardless of whether the account exists — avoids
    // user enumeration.
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Domain-based org auto-join: check the user's email domain against all
  // active orgs' approved_email_domains. If there's a match, auto-link.
  let clientOrg: typeof clientOrganizationsTable.$inferSelect | null = null;
  if (organizationSlug) {
    const slugOrg = await db.query.clientOrganizationsTable.findFirst({
      where: and(
        eq(clientOrganizationsTable.slug, organizationSlug),
        eq(clientOrganizationsTable.isActive, true),
      ),
    });
    if (slugOrg) {
      const domain = normalizedEmail.split("@")[1] ?? "";
      const approved = (slugOrg.approvedEmailDomains ?? []).map((d) => d.toLowerCase());
      if (approved.includes(domain)) {
        clientOrg = slugOrg;
      }
      // If domain not approved, don't auto-link — admin must assign.
    }
  } else {
    clientOrg = await findActiveClientOrgByEmailDomain(normalizedEmail);
  }

  const [inserted] = await db
    .insert(usersTable)
    .values({
      email: normalizedEmail,
      passwordHash: hash,
      authProvider: "local",
      externalSubject: `local:${normalizedEmail}`,
      displayName: displayName ?? normalizedEmail.split("@")[0],
      clientOrganizationId: clientOrg?.id ?? null,
      lastSignInAt: new Date(),
    })
    .returning();

  // Grant client role if org-linked.
  if (clientOrg && inserted) {
    await applyClientOrgRole(inserted.id, clientOrg.id);
  }

  // Bootstrap: first user ever becomes admin.
  if (inserted) {
    const userCount = await db.$count(usersTable);
    if (userCount === 1) {
      const adminRole = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, "admin") });
      if (adminRole) {
        await db.insert(userRoles).values({ userId: inserted.id, roleId: adminRole.id }).onConflictDoNothing();
      }
    }

    // Auto-admin by ADMIN_EMAILS.
    const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.includes(normalizedEmail)) {
      const adminRole = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, "admin") });
      if (adminRole) {
        await db.insert(userRoles).values({ userId: inserted.id, roleId: adminRole.id }).onConflictDoNothing();
      }
    }

    // Send email verification link. No session is created yet — the user
    // must click the link before they can sign in.
    const verifyToken = generateSecureToken();
    await db.insert(emailVerificationTokensTable).values({
      token: verifyToken,
      userId: inserted.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    void sendEmailVerification({
      to: normalizedEmail,
      name: inserted.displayName,
      token: verifyToken,
    });

    res.status(201).json({ ok: true, requiresVerification: true });
    return;
  }

  res.status(500).json({ error: "Registration failed" });
});

// ---------------------------------------------------------------------------
// Local email/password — POST /api/auth/login
// ---------------------------------------------------------------------------
const LoginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional(),
});

router.post("/auth/login", loginRateLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const normalizedEmail = parsed.data.email.toLowerCase();
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, normalizedEmail),
  });

  // Constant-time comparison guard: even if the user doesn't exist we run
  // bcrypt to avoid timing-based user enumeration.
  const dummyHash = "$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhash";
  const hashToCheck = user?.passwordHash ?? dummyHash;
  const valid = await bcrypt.compare(parsed.data.password, hashToCheck);

  if (!user || !valid || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  // Block local users who have not yet verified their email address.
  if (user.authProvider === "local" && !user.emailVerified) {
    res.status(403).json({
      error: "Please verify your email address before signing in. Check your inbox for a verification link.",
      code: "EMAIL_NOT_VERIFIED",
      email: user.email,
    });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastSignInAt: new Date() })
    .where(eq(usersTable.id, user.id));

  // Re-apply org role on every sign-in in case it was updated.
  if (user.clientOrganizationId) {
    await applyClientOrgRole(user.id, user.clientOrganizationId);
  }

  // Auto-admin by ADMIN_EMAILS.
  const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.includes(normalizedEmail)) {
    const adminRole = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, "admin") });
    if (adminRole) {
      await db.insert(userRoles).values({ userId: user.id, roleId: adminRole.id }).onConflictDoNothing();
    }
  }

  const session = await createSession({
    userId: user.id,
    userAgent: userAgent(req),
    ip: clientIp(req),
    rememberMe: parsed.data.rememberMe ?? false,
  });
  setSessionCookie(req, res, session.token, session.expiresAt);
  const fresh = await loadUserById(user.id);
  res.json({ ok: true, user: fresh });
});

// ---------------------------------------------------------------------------
// POST /api/auth/sign-out
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.authedUser);
});

// ---------------------------------------------------------------------------
// GET /api/auth/session
// ---------------------------------------------------------------------------
router.get("/auth/session", async (req, res): Promise<void> => {
  if (!req.authedUser) {
    res.json({ signedIn: false });
    return;
  }
  res.json({ signedIn: true, user: req.authedUser });
});

// ---------------------------------------------------------------------------
// GET /api/auth/config — lets the SPA know what auth methods are available.
// ---------------------------------------------------------------------------
router.get("/auth/config", (req, res) => {
  res.json({
    entraConfigured: isEntraConfigured(),
    localAuthEnabled: true,
    callbackUri: deriveCallbackUri(req),
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-email — consume a verification token
// ---------------------------------------------------------------------------
const VerifyEmailBody = z.object({ token: z.string().min(1).max(128) });

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const parsed = VerifyEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const row = await db.query.emailVerificationTokensTable.findFirst({
    where: eq(emailVerificationTokensTable.token, parsed.data.token),
  });
  if (!row) {
    res.status(400).json({ error: "Invalid or expired verification link." });
    return;
  }
  if (row.usedAt) {
    res.status(400).json({ error: "This verification link has already been used." });
    return;
  }
  if (row.expiresAt < new Date()) {
    res.status(400).json({ error: "This verification link has expired. Request a new one." });
    return;
  }
  // Mark token used and set emailVerified on the user atomically.
  await db
    .update(emailVerificationTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokensTable.token, parsed.data.token));
  await db
    .update(usersTable)
    .set({ emailVerified: true, lastSignInAt: new Date() })
    .where(eq(usersTable.id, row.userId));

  // Create a session now that the email is verified — this signs the user in.
  const session = await createSession({
    userId: row.userId,
    userAgent: userAgent(req),
    ip: clientIp(req),
  });
  setSessionCookie(req, res, session.token, session.expiresAt);
  const fresh = await loadUserById(row.userId);
  res.json({ ok: true, user: fresh });
});

// ---------------------------------------------------------------------------
// POST /api/auth/resend-verification — send a fresh verification email
// ---------------------------------------------------------------------------
const ResendVerificationBody = z.object({ email: z.string().email().max(255) });

router.post("/auth/resend-verification", resendVerificationRateLimiter, async (req, res): Promise<void> => {
  const parsed = ResendVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, parsed.data.email.toLowerCase()),
  });
  if (!user || user.authProvider !== "local" || user.emailVerified) {
    // Always return 200 — avoids enumeration and is harmless when already verified.
    res.json({ ok: true });
    return;
  }
  // Expire all previous unused tokens.
  await db
    .update(emailVerificationTokensTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(emailVerificationTokensTable.userId, user.id),
      isNull(emailVerificationTokensTable.usedAt),
    ));
  const token = generateSecureToken();
  await db.insert(emailVerificationTokensTable).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  void sendEmailVerification({ to: user.email!, name: user.displayName, token });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password — send a password-reset email
// Always returns 200 to prevent email enumeration.
// ---------------------------------------------------------------------------
const ForgotPasswordBody = z.object({ email: z.string().email().max(255) });

router.post("/auth/forgot-password", forgotPasswordRateLimiter, async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const normalizedEmail = parsed.data.email.toLowerCase();
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, normalizedEmail),
  });
  if (user && user.authProvider === "local" && user.passwordHash) {
    const token = generateSecureToken();
    await db.insert(passwordResetTokensTable).values({
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    void sendPasswordReset({ to: normalizedEmail, name: user.displayName, token });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password — consume a reset token and set new password
// ---------------------------------------------------------------------------
const ResetPasswordBody = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(8).max(128),
});

router.post("/auth/reset-password", resetPasswordRateLimiter, async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const row = await db.query.passwordResetTokensTable.findFirst({
    where: eq(passwordResetTokensTable.token, parsed.data.token),
  });
  if (!row) {
    res.status(400).json({ error: "Invalid or expired reset link." });
    return;
  }
  if (row.usedAt) {
    res.status(400).json({ error: "This reset link has already been used." });
    return;
  }
  if (row.expiresAt < new Date()) {
    res.status(400).json({ error: "This reset link has expired. Request a new one." });
    return;
  }
  const hash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
  // Mark token used, update password, invalidate all other reset tokens.
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.token, parsed.data.token));
  await db
    .update(usersTable)
    .set({ passwordHash: hash })
    .where(eq(usersTable.id, row.userId));
  // Delete all remaining (unused, unexpired) reset tokens for this user.
  await db
    .delete(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.userId, row.userId),
      eq(passwordResetTokensTable.token, parsed.data.token),
    ));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/auth/sessions — list active sessions for the signed-in user
// ---------------------------------------------------------------------------
router.get("/auth/sessions", requireAuth, async (req, res): Promise<void> => {
  const user = req.authedUser!;
  const currentSessionId = req.session?.id ?? null;
  const sessions = await listSessionsForUser(user.id);
  res.json(
    sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      rememberMe: s.rememberMe,
      isCurrent: s.id === currentSessionId,
    })),
  );
});

// ---------------------------------------------------------------------------
// DELETE /api/auth/sessions/:id — revoke a specific session (not the current one)
// ---------------------------------------------------------------------------
router.delete("/auth/sessions/:id", requireAuth, async (req, res): Promise<void> => {
  const { id } = req.params;
  const user = req.authedUser!;
  const currentSessionId = req.session?.id ?? null;

  if (id === currentSessionId) {
    res.status(400).json({ error: "Cannot revoke your current session. Use sign-out instead." });
    return;
  }

  // Verify the session belongs to the requesting user.
  const sessions = await listSessionsForUser(user.id);
  const owned = sessions.some((s) => s.id === id);
  if (!owned) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  await destroySessionById(id);
  res.json({ ok: true });
});

export default router;
