import { db, auditLogTable } from "@workspace/db";

export async function audit(params: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  diff?: unknown;
}): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: params.actorId ?? null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      diffJson: (params.diff ?? null) as never,
    });
  } catch {
    // Audit logging should never break the request.
  }
}

const DEFAULT_IGNORE_KEYS = ["updatedAt", "createdAt"] as const;

// Build an audit diff that captures the full before/after for the fields that
// actually changed. This is the recovery payload — readable in SQL, and small
// enough to stay useful even when a blank form overwrites many fields at once.
// Housekeeping timestamps are excluded by default via `ignoreKeys`.
export function buildAuditDiff<T extends Record<string, unknown>>(
  before: T,
  after: T,
  { ignoreKeys = DEFAULT_IGNORE_KEYS }: { ignoreKeys?: readonly string[] } = {},
): { before: Partial<T>; after: Partial<T> } | null {
  const beforeChanged: Partial<T> = {};
  const afterChanged: Partial<T> = {};
  let changed = false;
  const keys = new Set<keyof T>([
    ...(Object.keys(before) as (keyof T)[]),
    ...(Object.keys(after) as (keyof T)[]),
  ]);
  for (const k of keys) {
    if (ignoreKeys.includes(k as string)) continue;
    if (!isEqualJson(before[k], after[k])) {
      beforeChanged[k] = before[k];
      afterChanged[k] = after[k];
      changed = true;
    }
  }
  return changed ? { before: beforeChanged, after: afterChanged } : null;
}

function isEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
