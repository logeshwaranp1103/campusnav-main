import { describe, it, expect } from "vitest";
import { solveAffineMatrix, gpsToCanvas, canvasToGps, type CalibrationPoint } from "../lib/geo/affine";
import { calculateGeographicDistance, findNearestNodeByGps } from "../lib/geo/haversine";

const testPoints: CalibrationPoint[] = [
  { canvasX: 0, canvasY: 0, lat: 12.9710, lng: 77.5940 },
  { canvasX: 1000, canvasY: 0, lat: 12.9710, lng: 77.5950 },
  { canvasX: 0, canvasY: 1000, lat: 12.9720, lng: 77.5940 },
  { canvasX: 1000, canvasY: 1000, lat: 12.9720, lng: 77.5950 },
];

describe("Geo-Calibration & Distance Calculations", () => {
  it("computes exact forward transform matrix from calibration points", () => {
    const matrix = solveAffineMatrix(testPoints);
    expect(matrix).not.toBeNull();

    if (!matrix) return;

    // Test (lng=77.5940, lat=12.9710) -> should map to (0, 0)
    const p1 = gpsToCanvas(12.9710, 77.5940, matrix);
    expect(Math.abs(p1.x - 0)).toBeLessThan(5);
    expect(Math.abs(p1.y - 0)).toBeLessThan(5);

    // Test (lng=77.5950, lat=12.9710) -> should map to (1000, 0)
    const p2 = gpsToCanvas(12.9710, 77.5950, matrix);
    expect(Math.abs(p2.x - 1000)).toBeLessThan(5);
    expect(Math.abs(p2.y - 0)).toBeLessThan(5);
  });

  it("computes exact inverse transform canvas (x, y) -> GPS (lat, lng)", () => {
    const matrix = solveAffineMatrix(testPoints);
    expect(matrix).not.toBeNull();

    if (!matrix) return;

    const gps = canvasToGps(500, 500, matrix);
    expect(Math.abs(gps.lat - 12.9715)).toBeLessThan(0.001);
    expect(Math.abs(gps.lng - 77.5945)).toBeLessThan(0.001);
  });

  it("calculates accurate real-world distances in meters using equirectangular formula", () => {
    // Section 10 Sample Validation Test:
    // Point A: Lat 11.031000, Lng 77.120000
    // Point B: Lat 11.032000, Lng 77.121000
    // Expected distance: ~156 meters
    const sampleDist = calculateGeographicDistance(11.031000, 77.120000, 11.032000, 77.121000);
    expect(sampleDist).toBe(156);
  });

  it("snaps visitor live GPS position to the nearest navigation node", () => {
    const nodes = [
      { id: "n1", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 100, lat: 12.9716, lng: 77.5946 },
      { id: "n2", type: "BUILDING_ENTRANCE", floorId: "f-out", x: 300, y: 300, lat: 12.9750, lng: 77.5980 },
    ];

    const nearest = findNearestNodeByGps(12.97162, 77.59461, nodes as any);
    expect(nearest.node?.id).toBe("n1");
    expect(nearest.distanceMeters).toBeLessThan(10);
  });
});
