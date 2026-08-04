import { useState, useEffect } from "react";
import { findNearestNodeByGps } from "@/lib/geo/haversine";
import { campusStore } from "@/shared/lib/campus-store";

export interface VisitorGpsState {
  lat: number;
  lng: number;
  accuracy: number; // in meters
  heading: number; // 0 to 360 degrees
  speed: number | null;
  canvasPos: { x: number; y: number; floorId: string };
  isGpsActive: boolean;
  error: string | null;
}

export function useVisitorGps(initialCanvasPos = { x: 400, y: 300, floorId: "f-out" }): VisitorGpsState & {
  recenter: (pos?: { x: number; y: number; floorId: string }) => void;
} {
  const [gpsState, setGpsState] = useState<VisitorGpsState>({
    lat: 12.9716,
    lng: 77.5946,
    accuracy: 8,
    heading: 0,
    speed: null,
    canvasPos: initialCanvasPos,
    isGpsActive: false,
    error: null,
  });

  // Device GPS Positioning
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGpsState((prev) => ({ ...prev, error: "Geolocation not supported" }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        const nearest = findNearestNodeByGps(latitude, longitude, campusStore.getPublishedData().nodes);

        setGpsState((prev) => ({
          ...prev,
          lat: latitude,
          lng: longitude,
          accuracy: accuracy || 10,
          heading: heading !== null && !isNaN(heading) ? heading : prev.heading,
          speed: speed || null,
          canvasPos: nearest.node
            ? { x: nearest.node.x, y: nearest.node.y, floorId: nearest.node.floorId }
            : prev.canvasPos,
          isGpsActive: true,
          error: null,
        }));
      },
      (err) => {
        setGpsState((prev) => ({
          ...prev,
          isGpsActive: false,
          error: err.message,
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Device Orientation / Compass Heading
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      let compassHeading: number | null = null;

      // iOS WebKit Compass Heading
      if ("webkitCompassHeading" in e && typeof (e as any).webkitCompassHeading === "number") {
        compassHeading = (e as any).webkitCompassHeading;
      } else if (e.alpha !== null) {
        // Android / Standard Compass Heading
        compassHeading = (360 - e.alpha) % 360;
      }

      if (compassHeading !== null && !isNaN(compassHeading)) {
        setGpsState((prev) => ({ ...prev, heading: Math.round(compassHeading!) }));
      }
    };

    window.addEventListener("deviceorientationabsolute" as any, handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);

    return () => {
      window.removeEventListener("deviceorientationabsolute" as any, handleOrientation, true);
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, []);

  const recenter = (pos?: { x: number; y: number; floorId: string }) => {
    if (pos) {
      setGpsState((prev) => ({ ...prev, canvasPos: pos }));
    }
  };

  return {
    ...gpsState,
    recenter,
  };
}
