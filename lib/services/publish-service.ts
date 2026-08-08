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
      const defaultCampusId = "c1";
      const ops: any[] = [
        prisma.campus.upsert({
          where: { id: defaultCampusId },
          update: {},
          create: {
            id: defaultCampusId,
            name: "Main Campus",
            slug: "main",
            latitude: 11.4965,
            longitude: 77.2774,
            status: "PUBLISHED",
          },
        }),
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
        prisma.mapVersion.create({
          data: {
            version: versionNum,
            status: "PUBLISHED",
            snapshot: draftSnapshot as any,
            notes: notes || "Published campus graph update",
            publishedBy: userId,
          },
        }),
      ];

      // Upsert Buildings into relational DB table
      if (buildings && Array.isArray(buildings)) {
        for (const b of buildings) {
          ops.push(
            prisma.building.upsert({
              where: { id: b.id },
              update: {
                campusId: b.campusId || defaultCampusId,
                name: b.name,
                shortCode: b.shortCode || b.id,
                color: b.color || "#4f46e5",
                description: b.description || null,
                x: b.x ?? null,
                y: b.y ?? null,
                width: b.width ?? null,
                height: b.height ?? null,
                status: "PUBLISHED",
              },
              create: {
                id: b.id,
                campusId: b.campusId || defaultCampusId,
                name: b.name,
                shortCode: b.shortCode || b.id,
                color: b.color || "#4f46e5",
                description: b.description || null,
                x: b.x ?? null,
                y: b.y ?? null,
                width: b.width ?? null,
                height: b.height ?? null,
                status: "PUBLISHED",
              },
            })
          );
        }
      }

      // Upsert Floors into relational DB table
      if (floors && Array.isArray(floors)) {
        const validBuildingIds = new Set((buildings || []).map((b) => b.id));
        for (const f of floors) {
          if (validBuildingIds.has(f.buildingId)) {
            ops.push(
              prisma.floor.upsert({
                where: { id: f.id },
                update: {
                  buildingId: f.buildingId,
                  name: f.name,
                  ordinal: f.ordinal ?? 0,
                },
                create: {
                  id: f.id,
                  buildingId: f.buildingId,
                  name: f.name,
                  ordinal: f.ordinal ?? 0,
                },
              })
            );
          }
        }
      }

      // Upsert Nodes into relational DB table
      if (nodes && Array.isArray(nodes)) {
        const validFloorIds = new Set((floors || []).map((f) => f.id));
        for (const n of nodes) {
          const floorId = n.floorId && validFloorIds.has(n.floorId) ? n.floorId : null;
          ops.push(
            prisma.node.upsert({
              where: { id: n.id },
              update: {
                campusId: n.campusId || defaultCampusId,
                floorId,
                type: n.type as any,
                name: n.name || null,
                latitude: n.lat ?? null,
                longitude: n.lng ?? null,
                x: n.x ?? null,
                y: n.y ?? null,
              },
              create: {
                id: n.id,
                campusId: n.campusId || defaultCampusId,
                floorId,
                type: n.type as any,
                name: n.name || null,
                latitude: n.lat ?? null,
                longitude: n.lng ?? null,
                x: n.x ?? null,
                y: n.y ?? null,
              },
            })
          );
        }
      }

      // Upsert Edges into relational DB table
      if (edges && Array.isArray(edges)) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        for (const e of edges) {
          const fromId = e.fromNodeId || e.from;
          const toId = e.toNodeId || e.to;
          if (fromId && toId && validNodeIds.has(fromId) && validNodeIds.has(toId)) {
            ops.push(
              prisma.edge.upsert({
                where: { id: e.id },
                update: {
                  fromNodeId: fromId,
                  toNodeId: toId,
                  type: (e.type as any) || "WALK",
                  distance: e.distance ?? 1,
                  bidirectional: e.bidirectional ?? true,
                  status: "PUBLISHED",
                },
                create: {
                  id: e.id,
                  fromNodeId: fromId,
                  toNodeId: toId,
                  type: (e.type as any) || "WALK",
                  distance: e.distance ?? 1,
                  bidirectional: e.bidirectional ?? true,
                  status: "PUBLISHED",
                },
              })
            );
          }
        }
      }

      // Upsert Destinations into relational DB table
      if (destinations && Array.isArray(destinations)) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        for (const d of destinations) {
          if (d.nodeId && validNodeIds.has(d.nodeId)) {
            ops.push(
              prisma.destination.upsert({
                where: { id: d.id },
                update: {
                  campusId: defaultCampusId,
                  nodeId: d.nodeId,
                  name: d.name,
                  category: d.category || "Custom",
                },
                create: {
                  id: d.id,
                  campusId: defaultCampusId,
                  nodeId: d.nodeId,
                  name: d.name,
                  category: d.category || "Custom",
                },
              })
            );
          }
        }
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
