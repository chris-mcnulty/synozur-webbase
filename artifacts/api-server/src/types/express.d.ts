import type { RoleName } from "@workspace/db";

export type AuthedUser = {
  id: string;
  externalSubject: string | null;
  authProvider: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  roles: RoleName[];
  // #111 — server-hydrated effective capabilities; mirror of the shape in
  // middlewares/auth.ts.
  effectiveCapabilities: string[];
};

export interface SessionContext {
  id: string;
  userId: string;
  expiresAt: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authedUser?: AuthedUser;
      session?: SessionContext;
    }
  }
}

export {};
