import { prisma } from "../db";
import { validateCampusGraph, type GraphValidationReport } from "../validation/graph-validator";
import { logAuditEvent } from "./audit-service";
import { getFloorCode, type Building, type Floor, type Node, type Edge, type Destination, type Obstacle } from "../../shared/data/campus";

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
      const ops: any[] = [
        prisma.publishedGraph.upsert({
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
        }),
        prisma.draftGraph.upsert({
          where: { id: "active-draft" },
          update: { snapshot: draftSnapshot as any },
          create: { id: "active-draft", snapshot: draftSnapshot as any },
        }),
      ];

      if (!nodes || nodes.length === 0) {
        ops.push(
          prisma.edge.deleteMany(),
          prisma.node.deleteMany(),
          prisma.destination.deleteMany(),
          prisma.floor.deleteMany(),
          prisma.building.deleteMany()
        );
      }

      await prisma.$transaction(ops);
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

export async function getRelationalGraphFromDatabase(): Promise<DraftSnapshot | null> {
  if (!prisma) return null;
  try {
    const [rawBuildings, rawFloors, rawNodes, rawEdges, rawDestinations] = await Promise.all([
      prisma.building.findMany(),
      prisma.floor.findMany(),
      prisma.node.findMany(),
      prisma.edge.findMany(),
      prisma.destination.findMany(),
    ]);

    if (rawNodes.length === 0 && rawBuildings.length === 0) {
      return null;
    }

    const buildings: Building[] = rawBuildings.map((b) => ({
      id: b.id,
      campusId: b.campusId,
      name: b.name,
      shortCode: b.shortCode ?? undefined,
      color: b.color ?? undefined,
      x: b.x ?? undefined,
      y: b.y ?? undefined,
      width: b.width ?? undefined,
      height: b.height ?? undefined,
    }));

    const floors: Floor[] = rawFloors.map((f) => ({
      id: f.id,
      buildingId: f.buildingId,
      name: f.name,
      ordinal: f.ordinal,
      code: getFloorCode(f.ordinal, f.name),
    }));

    const nodes: Node[] = rawNodes.map((n) => ({
      id: n.id,
      type: n.type as any,
      name: n.name ?? undefined,
      floorId: n.floorId ?? "",
      x: n.x ?? 0,
      y: n.y ?? 0,
      lat: n.latitude ?? undefined,
      lng: n.longitude ?? undefined,
      searchable: n.searchable ?? true,
    }));

    const edges: Edge[] = rawEdges.map((e) => ({
      id: e.id,
      from: e.fromNodeId,
      to: e.toNodeId,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      type: e.type as any,
      distance: e.distance,
      bidirectional: e.bidirectional ?? true,
    }));

    const destinations: Destination[] = rawDestinations.map((d) => ({
      id: d.id,
      nodeId: d.nodeId,
      name: d.name,
      category: d.category ?? "Custom",
      aliases: [],
    }));

    return {
      buildings,
      floors,
      nodes,
      edges,
      destinations,
      obstacles: [],
    };
  } catch (e) {
    console.warn("Error building graph snapshot from relational database:", e);
    return null;
  }
}

export async function getActivePublishedGraph() {
  if (prisma) {
    try {
      const dbRecord = (await prisma.publishedGraph.findUnique({
        where: { id: "active-published" },
      })) as any;

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

      const relationalGraph = await getRelationalGraphFromDatabase();
      if (relationalGraph) {
        activePublishedSnapshot = {
          version: dbRecord?.version ?? 1,
          snapshot: relationalGraph,
          publishedAt: dbRecord?.publishedAt ?? new Date(),
          publishedBy: "admin",
          notes: "Relational database graph",
        };
        return activePublishedSnapshot;
      }
    } catch (e) {
      console.warn("Failed to fetch active published graph from Prisma database:", e);
    }
  }

  return activePublishedSnapshot;
}
