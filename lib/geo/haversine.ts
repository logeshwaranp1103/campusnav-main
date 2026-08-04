import type { Node } from "../../shared/data/campus";

const EARTH_RADIUS_METERS = 6371000; // Earth mean radius in meters

/**
 * Calculates the exact geographic distance in meters between two (latitude, longitude) coordinates
 * using the Haversine formula.
 */
export function calculateHaversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
    return 10; // Fallback distance
  }

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = EARTH_RADIUS_METERS * c;

  return Math.max(1, Math.round(distanceMeters));
}

/**
 * Finds the nearest navigation node to a given (latitude, longitude) coordinate
 * matching the active floor or outdoor area.
 */
export function findNearestNodeByGps(
  lat: number,
  lng: number,
  nodes: Node[],
  floorId = "f-out",
  maxDistanceMeters = 300
): { node: Node | null; distanceMeters: number } {
  const eligibleNodes = nodes.filter((n) => {
    if (!n.lat || !n.lng) return false;
    if (floorId === "f-out") return n.floorId === "f-out" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode;
    return n.floorId === floorId || n.floorId === "f-out";
  });

  if (eligibleNodes.length === 0) {
    const fallbackNode = nodes.find((n) => n.lat && n.lng) ?? null;
    if (!fallbackNode) return { node: null, distanceMeters: Infinity };
    const dist = calculateHaversineDistance(lat, lng, fallbackNode.lat!, fallbackNode.lng!);
    return { node: fallbackNode, distanceMeters: dist };
  }

  let nearestNode: Node | null = null;
  let minDistance = Infinity;

  eligibleNodes.forEach((n) => {
    const dist = calculateHaversineDistance(lat, lng, n.lat!, n.lng!);
    if (dist < minDistance) {
      minDistance = dist;
      nearestNode = n;
    }
  });

  return {
    node: nearestNode,
    distanceMeters: minDistance <= maxDistanceMeters ? minDistance : minDistance,
  };
}
