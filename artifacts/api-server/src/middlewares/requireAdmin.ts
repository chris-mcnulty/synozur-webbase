import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

export interface AdminInfo {
  userId: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminInfo;
    }
  }
}

function getAllowedEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export async function getCurrentAdmin(
  req: Request,
): Promise<{ status: "unauthenticated" } | { status: "unauthorized"; email: string } | { status: "ok"; info: AdminInfo }> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) return { status: "unauthenticated" };

  const user = await clerkClient.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress?.toLowerCase() ??
    user.emailAddresses[0]?.emailAddress?.toLowerCase() ??
    "";

  const allowed = getAllowedEmails();
  // If no allow-list is configured, treat any signed-in user as authorized
  // (useful for first-run/dev). Otherwise enforce membership.
  if (allowed.length > 0 && !allowed.includes(email)) {
    return { status: "unauthorized", email };
  }
  return { status: "ok", info: { userId, email } };
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const result = await getCurrentAdmin(req);
  if (result.status === "unauthenticated") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (result.status === "unauthorized") {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  req.admin = result.info;
  next();
}
