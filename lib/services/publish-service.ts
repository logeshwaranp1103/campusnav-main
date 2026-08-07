import { prisma } from "../db";
import { validateCampusGraph, type GraphValidationReport } from "../validation/graph-validator";
import { logAuditEvent } from "./audit-service";
import type { Building, Floor, Node, Edge, Destination, Obstacle } from "../../shared/data/campus";

export interface PublishResult {
  success: boolean;
  version?: number;
  publishedAt?: Date;
  validationReport: GraphValidationReport;
  error?: string;
}

export type DraftSnapshot = {
  buildings?: Building[];
  floors?: Floor[];
  nodes?: Node[];
  edges?: Edge[];
  destinations?: Destination[];
  obstacles?: Obstacle[];
  [key: string]: unknown;
};

let activePublishedSnapshot: { version: number; snapshot: DraftSnapshot; publishedAt: Date; publishedBy: string; notes: string } | null = null;

export async function publishDraftGraph(
  draftSnapshot: DraftSnapshot,
  userId = "admin-id-1",
  notes?: string
): Promise<PublishResult> {
  const { buildings, floors, nodes, edges, destinations, obstacles } = draftSnapshot;

  const validationReport = validateCampusGraph(
    buildings || [],
    floors || [],
    nodes || [],
    edges || [],
    destinations || [],
    obstacles || []
  );

  if (validationReport.issues.some((i) => i.severity === "CRITICAL")) {
    return {
      success: false,
      validationReport,
      error: "Publishing blocked: Graph Validation Engine found critical errors. Fix issues before publishing.",
    };
  }

  const currentSnapshot = await getActivePublishedGraph();
  const versionNum = (currentSnapshot?.version ?? 0) + 1;
  const publishedAt = new Date();

  activePublishedSnapshot = {
    version: versionNum,
    snapshot: draftSnapshot,
    publishedAt,
    publishedBy: userId,
    notes: notes || "Published campus graph update",
  };

  if (prisma) {
    try {
      const dbPromise = prisma.publishedGraph.upsert({
        where: { id: "active-published" },
        update: {
          version: versionNum,
          snapshot: draftSnapshot as any,
          publishedAt,
          publishedBy: userId,
        },
        create: {
          id: "active-published",
          version: versionNum,
          snapshot: draftSnapshot as any,
          publishedAt,
          publishedBy: userId,
        },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 800)
      );
      await Promise.race([dbPromise, timeoutPromise]);
    } catch (e) {
      console.warn("Failed to persist published graph to Prisma database:", e);
    }
  }

  await logAuditEvent({
    userId,
    action: "GRAPH_PUBLISHED",
    resource: "campus-graph",
    resourceId: `v${versionNum}`,
    after: { version: versionNum, notes },
  });

  return {
    success: true,
    version: versionNum,
    publishedAt,
    validationReport,
  };
}

export async function getActivePublishedGraph() {
  if (prisma) {
    try {
      const dbPromise = prisma.publishedGraph.findUnique({
        where: { id: "active-published" },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 800)
      );
      const dbRecord = (await Promise.race([dbPromise, timeoutPromise])) as any;
      if (dbRecord && dbRecord.snapshot) {
        activePublishedSnapshot = {
          version: dbRecord.version,
          snapshot: dbRecord.snapshot as DraftSnapshot,
          publishedAt: dbRecord.publishedAt,
          publishedBy: dbRecord.publishedBy || "admin",
          notes: "Database published graph",
        };
        return activePublishedSnapshot;
      }
    } catch {
      // Fallback if DB disconnected or timed out
    }
  }

  return activePublishedSnapshot;
}
