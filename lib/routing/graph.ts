import type { Node, Edge, Obstacle } from "../../shared/data/campus";
import { calculateHaversineDistance } from "../geo/haversine";

export type AdjacencyEdge = {
  edgeId: string;
  from: string;
  to: string;
  type: Edge["type"];
  distance: number;
  bidirectional: boolean;
  weight: number;
};

export type GraphAdjacencyMap = Map<string, AdjacencyEdge[]>;



export interface BuildGraphOptions {
  obstacles?: Obstacle[];
  activeEdgeIds?: Set<string>;
  allowObstaclePenalties?: boolean;
}

export function getObstructedEdgeIds(
  nodes: Node[],
  edges: Edge[],
  obstacles: Obstacle[] = []
): Set<string> {
  const nodeMap = new Map<string, Node>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const activeObstacles = (obstacles ?? []).filter((obs) => {
    if (!obs.expiresAt) return true;
    return new Date(obs.expiresAt).getTime() > Date.now();
  });

  const blockedEdgeIds = new Set<string>();

  edges.forEach((e) => {
    const fromId = e.fromNodeId ?? e.from;
    const toId = e.toNodeId ?? e.to;
    if (!fromId || !toId || !nodeMap.has(fromId) || !nodeMap.has(toId)) return;

    const fromNode = nodeMap.get(fromId)!;
    const toNode = nodeMap.get(toId)!;
    const baseEdgeId = e.id.replace(/_rev$/, "");

    for (const obs of activeObstacles) {
      // 1. Explicit edgeIds match: if specified, ONLY block matching edgeIds and skip spatial check
      if (obs.edgeIds && obs.edgeIds.length > 0) {
        if (
          obs.edgeIds.includes(e.id) ||
          obs.edgeIds.includes(baseEdgeId) ||
          obs.edgeIds.includes(`${baseEdgeId}_rev`)
        ) {
          blockedEdgeIds.add(e.id);
          blockedEdgeIds.add(`${e.id}_rev`);
          break;
        }
        continue; // Skip spatial check if explicit edgeIds are set
      }

      // 2. Spatial area hazard: check radius against line segment
      if (
        obs.floorId &&
        obs.floorId !== "f-out" &&
        fromNode.floorId !== obs.floorId &&
        toNode.floorId !== obs.floorId
      ) {
        continue;
      }

      const radius = obs.radius ?? 20;
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;

      let t = ((obs.x - fromNode.x) * dx + (obs.y - fromNode.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = fromNode.x + t * dx;
      const projY = fromNode.y + t * dy;
      const dist = Math.hypot(obs.x - projX, obs.y - projY);

      if (dist <= radius) {
        // Endpoint bleed protection: if projection falls near segment ends, require tighter radius
        if ((t < 0.15 || t > 0.85) && dist > radius * 0.5) {
          continue;
        }
        blockedEdgeIds.add(e.id);
        blockedEdgeIds.add(`${e.id}_rev`);
        break;
      }
    }
  });

  return blockedEdgeIds;
}

export function buildAdjacencyGraph(
  nodes: Node[],
  edges: Edge[],
  options: BuildGraphOptions = {}
): { graph: GraphAdjacencyMap; nodeMap: Map<string, Node> } {
  const nodeMap = new Map<string, Node>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const blockedEdgeIds = getObstructedEdgeIds(nodes, edges, options.obstacles ?? []);

  const graph: GraphAdjacencyMap = new Map();
  nodes.forEach((n) => graph.set(n.id, []));

  // Track directed adjacency entries to avoid duplicates.
  // Key: "fromId->toId" — only skip if the exact same directed link was already added.
  const addedDirected = new Set<string>();

  const addDirectedEdge = (
    from: string,
    to: string,
    edgeId: string,
    type: Edge["type"],
    dist: number,
    weight: number
  ) => {
    const dirKey = `${from}->${to}`;
    if (addedDirected.has(dirKey)) return;
    addedDirected.add(dirKey);

    const adj: AdjacencyEdge = {
      edgeId,
      from,
      to,
      type,
      distance: dist,
      bidirectional: true,
      weight,
    };
    const out = graph.get(from) ?? [];
    out.push(adj);
    graph.set(from, out);
  };

  edges.forEach((e) => {
    const fromId = e.fromNodeId ?? e.from;
    const toId = e.toNodeId ?? e.to;

    // Ignore edges with invalid or non-existent nodes
    if (!fromId || !toId || !nodeMap.has(fromId) || !nodeMap.has(toId)) return;

    // Exclude explicitly closed edges (runtime-only extended fields)
    const extEdge = e as any;
    if (extEdge.closed) return;
    if (extEdge.closedUntil && new Date(extEdge.closedUntil).getTime() > Date.now()) return;

    // Check if edge or its reverse twin is blocked by an obstacle
    const isBlocked =
      blockedEdgeIds.has(e.id) ||
      blockedEdgeIds.has(`${e.id}_rev`) ||
      (e.id.endsWith("_rev") && blockedEdgeIds.has(e.id.replace(/_rev$/, ""))) ||
      blockedEdgeIds.has(`e-${toId}-${fromId}`);

    if (isBlocked && !options.allowObstaclePenalties) {
      return;
    }

    // Type penalty: very small for stairs/lifts so direct stair routes are always preferred
    let modePenalty = 0;
    if (e.type === "STAIRS") modePenalty = 2;
    if (e.type === "LIFT") modePenalty = 1;

    // Compute distance: use explicit e.distance if provided (>0), otherwise check vertical transition or canvas distance
    const fn = nodeMap.get(fromId)!;
    const tn = nodeMap.get(toId)!;
    let computedDist = typeof e.distance === "number" && e.distance > 0 ? e.distance : 0;

    if (!computedDist && fn && tn) {
      const isVerticalTransition = e.type === "STAIRS" || e.type === "LIFT" || fn.floorId !== tn.floorId;
      if (isVerticalTransition) {
        // Vertical transitions across floors have fixed floor height (15m), NEVER 2D canvas pixel distance
        computedDist = 15;
      } else if (fn.lat && fn.lng && tn.lat && tn.lng) {
        computedDist = calculateHaversineDistance(fn.lat, fn.lng, tn.lat, tn.lng);
      } else {
        const dx = tn.x - fn.x;
        const dy = tn.y - fn.y;
        computedDist = Math.hypot(dx, dy) / 4;
      }
    }

    const dist = Math.max(1, Math.round(computedDist || e.distance || 1));
    const weight = Math.max(1, dist * (extEdge.speedModifier ?? 1.0) + modePenalty);

    // ALWAYS add both forward AND backward — every campus edge is walkable in both directions
    addDirectedEdge(fromId, toId, e.id, e.type, dist, weight);
    addDirectedEdge(toId, fromId, `${e.id}_rev`, e.type, dist, weight);
  });

  // ── Ensure consecutive vertical STAIRS edges link stair nodes in exact floor order ──
  // Group stair nodes by stairGroupId or matching base stair name, then connect consecutive floor levels
  const stairGroupNodesMap = new Map<string, Node[]>();
  nodes.forEach((n) => {
    if (n.type === "STAIR" || n.stairGroupId) {
      const baseKey = n.stairGroupId || (n.name || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
      if (baseKey) {
        const list = stairGroupNodesMap.get(baseKey) || [];
        list.push(n);
        stairGroupNodesMap.set(baseKey, list);
      }
    }
  });

  stairGroupNodesMap.forEach((groupNodes) => {
    if (groupNodes.length >= 2) {
      // Sort nodes in floor sequence: Ground/Basement -> Floor 1 -> Floor 2 -> Floor 3 ...
      groupNodes.sort((a, b) => {
        const getFloorRank = (n: Node) => {
          // Extract floor portion inside parentheses, e.g. "STAIRS 1 (RP · Floor 2)" -> "rp · floor 2)"
          const nameParts = (n.name || "").split("(");
          const floorText = (nameParts.length > 1 ? nameParts[nameParts.length - 1] : n.name || "").toLowerCase();

          if (floorText.includes("base") || floorText.includes("b-") || floorText.includes("basement")) return -1;
          if (floorText.includes("ground") || floorText.includes("gnd") || floorText.includes("g)") || floorText.includes(" 0")) return 0;

          const match = floorText.match(/\d+/);
          if (match) {
            return parseInt(match[0], 10);
          }

          const fIdLower = (n.floorId || "").toLowerCase();
          if (fIdLower.includes("base") || fIdLower.includes("b-")) return -1;
          if (fIdLower.includes("ground") || fIdLower.endsWith("-g") || fIdLower.includes("-0")) return 0;

          const fIdMatch = fIdLower.match(/\d+/);
          return fIdMatch ? parseInt(fIdMatch[0], 10) : 1;
        };
        return getFloorRank(a) - getFloorRank(b);
      });

      for (let i = 0; i < groupNodes.length - 1; i++) {
        const fn = groupNodes[i];
        const tn = groupNodes[i + 1];
        if (fn.floorId !== tn.floorId) {
          const autoStairEdgeId = `e-stair-seq-${fn.id}-${tn.id}`;
          const dist = 15;
          const weight = 17; // 15m + 2 penalty for STAIRS
          addDirectedEdge(fn.id, tn.id, autoStairEdgeId, "STAIRS", dist, weight);
          addDirectedEdge(tn.id, fn.id, `${autoStairEdgeId}_rev`, "STAIRS", dist, weight);
        }
      }
    }
  });

  return { graph, nodeMap };
}

export function optimizeMultiStopRoute(
  graph: GraphAdjacencyMap,
  nodeMap: Map<string, Node>,
  startNodeId: string,
  intermediateNodeIds: string[],
  endNodeId?: string
): string[] {
  if (intermediateNodeIds.length <= 1) {
    return [startNodeId, ...intermediateNodeIds, ...(endNodeId ? [endNodeId] : [])];
  }

  // Nearest Neighbor TSP heuristic for multi-stop order optimization
  const unvisited = [...intermediateNodeIds];
  const ordered: string[] = [startNodeId];
  let current = startNodeId;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const target = unvisited[i];
      const fromN = nodeMap.get(current);
      const toN = nodeMap.get(target);
      const dist = fromN && toN ? Math.hypot(fromN.x - toN.x, fromN.y - toN.y) : 100;
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    current = unvisited[nearestIdx];
    ordered.push(current);
    unvisited.splice(nearestIdx, 1);
  }

  if (endNodeId) {
    ordered.push(endNodeId);
  }

  return ordered;
}
