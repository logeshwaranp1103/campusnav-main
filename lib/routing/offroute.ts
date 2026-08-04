import type { Node } from "../../shared/data/campus";
import type { PathResult } from "./dijkstra";

export interface OffRouteCheckResult {
  isOffRoute: boolean;
  distanceFromRoute: number;
  closestNodeId?: string;
}

export function checkOffRoute(
  userPos: { x: number; y: number; floorId: string },
  currentRoute: PathResult | null,
  thresholdMeters = 20
): OffRouteCheckResult {
  if (!currentRoute || currentRoute.nodes.length === 0) {
    return { isOffRoute: false, distanceFromRoute: 0 };
  }

  // Filter nodes matching current floor or floor transition
  const floorNodes = currentRoute.nodes.filter((n) => n.floorId === userPos.floorId);
  if (floorNodes.length === 0) {
    // Visitor is on a different floor than current route segment
    return { isOffRoute: true, distanceFromRoute: 100 };
  }

  let minDistance = Infinity;
  let closestNodeId: string | undefined = undefined;

  floorNodes.forEach((node) => {
    const dist = Math.hypot(userPos.x - node.x, userPos.y - node.y);
    if (dist < minDistance) {
      minDistance = dist;
      closestNodeId = node.id;
    }
  });

  return {
    isOffRoute: minDistance > thresholdMeters,
    distanceFromRoute: Math.round(minDistance),
    closestNodeId,
  };
}

export function detectEntranceTransition(
  userPos: { x: number; y: number; floorId: string },
  nodes: Node[],
  threshold = 30
): { transition: "ENTER_BUILDING" | "EXIT_BUILDING" | null; entranceNode?: Node } {
  const nearbyEntrance = nodes.find(
    (n) => (n.type === "BUILDING_ENTRANCE" || n.type === "ENTRANCE" || n.isEntranceNode) && Math.hypot(n.x - userPos.x, n.y - userPos.y) <= threshold
  );

  if (!nearbyEntrance) return { transition: null };

  if (userPos.floorId === "f-out" && nearbyEntrance.floorId !== "f-out") {
    return { transition: "ENTER_BUILDING", entranceNode: nearbyEntrance };
  }

  if (userPos.floorId !== "f-out" && nearbyEntrance.floorId === "f-out") {
    return { transition: "EXIT_BUILDING", entranceNode: nearbyEntrance };
  }

  return { transition: null, entranceNode: nearbyEntrance };
}
