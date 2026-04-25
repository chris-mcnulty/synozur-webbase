import { pgTable, uuid, text, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userRoles } from "./roles";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    // #126: Microsoft Entra SSO. When a user signs in via Entra (routed through
    // Clerk's enterprise SSO connection for the @synozur.com domain), the
    // tenant id + object id from the Entra token are mirrored here so role
    // mapping and offboarding stay deterministic if Clerk is later swapped.
    // `lastSsoProvider` records the most recent sign-in surface ("entra",
    // "google", "email-password", …) so admins can see how each user actually
    // authenticates.
    entraTenantId: text("entra_tenant_id"),
    entraObjectId: text("entra_object_id"),
    lastSsoProvider: text("last_sso_provider"),
    // `entraGroupClaims` is a snapshot of the group object-ids resolved at the
    // last successful sign-in. We persist it so the admin UI can show why a
    // role was granted, and so a deliberate refresh isn't required to inspect
    // group state (we still re-resolve on every sign-in).
    entraGroupClaims: jsonb("entra_group_claims").$type<string[]>(),
    entraGroupsRefreshedAt: timestamp("entra_groups_refreshed_at", { withTimezone: true }),
    // #131: marketing-consent state mirrored on the user row so a registered
    // user's opt-in/out propagates to HubSpot lifecycle changes regardless of
    // which surface flipped it.
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    marketingOptInUpdatedAt: timestamp("marketing_opt_in_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_clerk_user_id_key").on(t.clerkUserId),
    index("users_entra_object_id_idx").on(t.entraObjectId),
  ],
);

export const usersRelations = relations(usersTable, ({ many }) => ({
  userRoles: many(userRoles),
}));

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
