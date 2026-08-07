import { prisma } from "../db";

export interface AuditEventInput {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

const memoryAuditLogs: Array<AuditEventInput & { id: string; createdAt: Date }> = [];

export async function logAuditEvent(input: AuditEventInput) {
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    ...input,
    createdAt: new Date(),
  };

  memoryAuditLogs.unshift(entry);

  if (prisma) {
    try {
      const dbPromise = prisma.auditLog.create({
        data: {
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          before: input.before ? JSON.stringify(input.before) : undefined,
          after: input.after ? JSON.stringify(input.after) : undefined,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 800)
      );
      await Promise.race([dbPromise, timeoutPromise]);
    } catch {
      // Memory fallback if DB disconnected or timed out
    }
  }

  return entry;
}

export async function getAuditLogs(limit = 50) {
  if (prisma) {
    try {
      const dbPromise = prisma.auditLog.findMany({
        take: limit,
        orderBy: { createdAt: "desc" },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 800)
      );
      const logs = (await Promise.race([dbPromise, timeoutPromise])) as any[];
      if (logs && logs.length > 0) return logs;
    } catch {
      // Memory fallback
    }
  }

  return memoryAuditLogs.slice(0, limit);
}
