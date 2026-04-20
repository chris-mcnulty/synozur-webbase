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
