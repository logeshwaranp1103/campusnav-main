import fs from "fs";
import path from "path";
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

const CACHE_DIR = path.join(process.cwd(), ".data");
const CACHE_FILE = path.join(CACHE_DIR, "published_graph.json");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadPersistedPublishedGraph() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.snapshot) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load persisted published graph from disk:", e);
  }
  return null;
}

function savePersistedPublishedGraph(data: any) {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn("Failed to save published graph to disk:", e);
  }
}

let activePublishedSnapshot: { version: number; snapshot: DraftSnapshot; publishedAt: Date; publishedBy: string; notes: string } | null = null;

export async function publishDraftGraph(
  draftSnapshot: DraftSnapshot,
  userId = "admin-id-1",
  notes?: string
): Promise<PublishResult> {
  const { buildings, floors, nodes, edges, destinations, obstacles } = draftSnapshot;

  // Run 10-Point Graph Validation Engine Guardrails
  const validationReport = validateCampusGraph(
    buildings || [],
    floors || [],
    nodes || [],
    edges || [],
    destinations || [],
    obstacles || []
  );

  // Reject publishing if critical errors exist
  if (validationReport.issues.some((i) => i.severity === "CRITICAL")) {
    return {
      success: false,
      validationReport,
      error: "Publishing blocked: Graph Validation Engine found critical errors. Fix issues before publishing.",
    };
  }

  const currentSnapshot = getActivePublishedGraph();
  const versionNum = (currentSnapshot?.version ?? 0) + 1;
  const publishedAt = new Date();

  activePublishedSnapshot = {
    version: versionNum,
    snapshot: draftSnapshot,
    publishedAt,
    publishedBy: userId,
    notes: notes || "Published campus graph update",
  };

  savePersistedPublishedGraph(activePublishedSnapshot);

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

export function getActivePublishedGraph() {
  if (!activePublishedSnapshot) {
    activePublishedSnapshot = loadPersistedPublishedGraph();
  }
  return activePublishedSnapshot;
}
