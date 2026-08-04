import { canvasToGps } from "../../lib/geo/boundary";
import {
  getFloorCode,
  type Building,
  type Floor,
  type Node,
  type Edge,
  type Destination,
  type Campus,
  type NodeType,
  type EdgeType,
  type Event,
  type Obstacle,
  type StairGroup,
  type LiftGroup,
  type Corridor,
  type Door,
  type SuggestedNode,
  type SuggestedEdge,
} from "../data/campus";

export type PendingChangeType =
  | "ADD_BUILDING"
  | "UPDATE_BUILDING"
  | "DELETE_BUILDING"
  | "ADD_FLOOR"
  | "UPDATE_FLOOR"
  | "DELETE_FLOOR"
  | "ADD_NODE"
  | "UPDATE_NODE"
  | "DELETE_NODE"
  | "ADD_EDGE"
  | "UPDATE_EDGE"
  | "DELETE_EDGE"
  | "ADD_DESTINATION"
  | "UPDATE_DESTINATION"
  | "DELETE_DESTINATION"
  | "ADD_EVENT"
  | "UPDATE_EVENT"
  | "DELETE_EVENT"
  | "ADD_OBSTACLE"
  | "UPDATE_OBSTACLE"
  | "DELETE_OBSTACLE"
  | "ADD_STAIR_GROUP"
  | "UPDATE_STAIR_GROUP"
  | "DELETE_STAIR_GROUP"
  | "ADD_LIFT_GROUP"
  | "UPDATE_LIFT_GROUP"
  | "DELETE_LIFT_GROUP"
  | "ADD_DOOR"
  | "UPDATE_DOOR"
  | "DELETE_DOOR"
  | "BULK_DELETE";

export type PendingChange = {
  id: string;
  type: PendingChangeType;
  entityType: "building" | "floor" | "node" | "edge" | "destination" | "event" | "obstacle" | "stairGroup" | "liftGroup" | "corridor" | "door";
  entityId: string;
  description: string;
  timestamp: number;
  prevData?: unknown;
  newData?: unknown;
};

export type AuditLogEntry = {
  id: string;
  action: "PUBLISH" | "UPDATE" | "CREATE" | "DELETE" | "LOGIN";
  resource: string;
  user: string;
  at: string;
  timestamp: number;
};

export type UndoHistoryEntry = {
  id: string;
  description: string;
  timestamp: number;
  snapshot: StoreSnapshot;
};

type StoreSnapshot = {
  buildings: Building[];
  floors: Floor[];
  nodes: Node[];
  edges: Edge[];
  destinations: Destination[];
  events: Event[];
  obstacles: Obstacle[];
  stairGroups?: StairGroup[];
  liftGroups?: LiftGroup[];
  corridors?: Corridor[];
  doors?: Door[];
  pendingChanges?: PendingChange[];
};

const defaultCampus: Campus = {
  id: "c1",
  name: "Main Campus",
  slug: "main",
  lat: 12.9716,
  lng: 77.5946,
};

export type Checkpoint = {
  id: string;
  name: string;
  timestamp: number;
  snapshot: StoreSnapshot;
};

class CampusStore {
  private campus: Campus = { ...defaultCampus };
  private publishedVersion = "v1.0";
  private checkpoints: Checkpoint[] = [];

  // Working (draft) data
  private buildings: Building[] = [];
  private floors: Floor[] = [];
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private destinations: Destination[] = [];
  private events: Event[] = [];
  private obstacles: Obstacle[] = [];
  private stairGroups: StairGroup[] = [];
  private liftGroups: LiftGroup[] = [];
  private corridors: Corridor[] = [];
  private doors: Door[] = [];
  private suggestedNodes: SuggestedNode[] = [];
  private suggestedEdges: SuggestedEdge[] = [];
  private clipboardData: {
    nodes?: Node[];
    destinations?: Destination[];
    doors?: Door[];
    edges?: Edge[];
  } | null = null;

  // Published snapshot (what public visitors see until published)
  private publishedGraph: StoreSnapshot = {
    buildings: [],
    floors: [],
    nodes: [],
    edges: [],
    destinations: [],
    events: [],
    obstacles: [],
    stairGroups: [],
    liftGroups: [],
    corridors: [],
    doors: [],
  };

  private pendingChanges: PendingChange[] = [];
  private auditLogs: AuditLogEntry[] = [];
  private undoStack: UndoHistoryEntry[] = [];
  private redoStack: UndoHistoryEntry[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.loadFromLocalStorage();
  }

  private saveToLocalStorage() {
    if (typeof window === "undefined") return;
    try {
      const working = {
        buildings: this.buildings,
        floors: this.floors,
        nodes: this.nodes,
        edges: this.edges,
        destinations: this.destinations,
        events: this.events,
        obstacles: this.obstacles,
        stairGroups: this.stairGroups,
        liftGroups: this.liftGroups,
        doors: this.doors,
        corridors: this.corridors,
        pendingChanges: this.pendingChanges,
      };
      localStorage.setItem("campusnav_working_store_v2", JSON.stringify(working));
      localStorage.setItem("campusnav_published_store_v2", JSON.stringify(this.publishedGraph));
      localStorage.setItem("campusnav_audit_logs_v2", JSON.stringify(this.auditLogs));
      localStorage.setItem("campusnav_checkpoints_v2", JSON.stringify(this.checkpoints));
    } catch (e) {
      console.warn("Failed to persist campus store", e);
    }
  }

  private loadFromLocalStorage() {
    if (typeof window === "undefined") return;
    try {
      const storedWorking = localStorage.getItem("campusnav_working_store_v2");
      const storedPublished = localStorage.getItem("campusnav_published_store_v2");
      let loadedValidData = false;

      if (storedWorking) {
        const parsed = JSON.parse(storedWorking);
        // Accept any valid saved state — even if all buildings were deleted by the user
        if (parsed && Array.isArray(parsed.buildings)) {
          this.buildings = parsed.buildings;
          this.floors = parsed.floors || [];
          this.nodes = parsed.nodes || [];
          this.edges = parsed.edges || [];
          this.destinations = parsed.destinations || [];
          this.events = parsed.events || [];
          this.obstacles = parsed.obstacles || [];
          this.stairGroups = parsed.stairGroups || [];
          this.liftGroups = parsed.liftGroups || [];
          this.doors = parsed.doors || [];
          this.corridors = parsed.corridors || [];
          this.pendingChanges = parsed.pendingChanges || [];
          this.syncVerticalGroupPositions();
          loadedValidData = true;
        }
      }

      if (!loadedValidData) {
        // No saved data — start with a clean empty canvas
        this.buildings = [];
        this.floors = [];
        this.nodes = [];
        this.edges = [];
        this.destinations = [];
        this.stairGroups = [];
        this.liftGroups = [];
        this.doors = [];
        this.corridors = [];
        this.events = [];
        this.obstacles = [];
      }

      if (storedPublished && loadedValidData) {
        const parsedPub = JSON.parse(storedPublished);
        this.publishedGraph = {
          buildings: parsedPub.buildings || [],
          floors: parsedPub.floors || [],
          nodes: parsedPub.nodes || [],
          edges: parsedPub.edges || [],
          destinations: parsedPub.destinations || [],
          events: parsedPub.events || [],
          obstacles: parsedPub.obstacles || [],
          stairGroups: parsedPub.stairGroups || [],
          liftGroups: parsedPub.liftGroups || [],
          doors: parsedPub.doors || [],
          corridors: parsedPub.corridors || [],
        };
      } else {
        // No published snapshot yet — publish graph is also empty
        this.publishedGraph = {
          buildings: [],
          floors: [],
          nodes: [],
          edges: [],
          destinations: [],
          events: [],
          obstacles: [],
          stairGroups: [],
          liftGroups: [],
          doors: [],
          corridors: [],
        };
      }

      const storedAudit = localStorage.getItem("campusnav_audit_logs_v1");
      if (storedAudit) {
        this.auditLogs = JSON.parse(storedAudit) || [];
      }
      const storedCheckpoints = localStorage.getItem("campusnav_checkpoints_v2");
      if (storedCheckpoints) {
        this.checkpoints = JSON.parse(storedCheckpoints) || [];
      }
      this.ensureDefaultGroundFloors();
    } catch (e) {
      console.warn("Failed to load campus store from localStorage", e);
    }
  }

  private ensureDefaultGroundFloors() {
    this.buildings.forEach((b) => {
      const hasFloor = this.floors.some((f) => f.buildingId === b.id);
      if (!hasFloor) {
        this.floors.push({
          id: `f-${b.id}-gnd`,
          buildingId: b.id,
          name: "Ground Floor",
          ordinal: 0,
        });
      }
    });

    if (this.publishedGraph.buildings) {
      this.publishedGraph.buildings.forEach((b) => {
        const hasFloor = this.publishedGraph.floors.some((f) => f.buildingId === b.id);
        if (!hasFloor) {
          this.publishedGraph.floors.push({
            id: `f-${b.id}-gnd`,
            buildingId: b.id,
            name: "Ground Floor",
            ordinal: 0,
          });
        }
      });
    }
  }

  public logAction(
    action: "PUBLISH" | "UPDATE" | "CREATE" | "DELETE" | "LOGIN",
    resource: string,
    user: string = "logeshwaranpalanic7@gmail.com"
  ) {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      action,
      resource,
      user,
      at: "Just now",
      timestamp: Date.now(),
    };
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 100) this.auditLogs.pop();
    this.saveToLocalStorage();
    this.notify();
  }

  public getAuditLogs(): AuditLogEntry[] {
    return this.auditLogs;
  }

  public resetToInitialData() {
    // Reset to a clean empty canvas (no mock data)
    this.buildings = [];
    this.floors = [];
    this.nodes = [];
    this.edges = [];
    this.destinations = [];
    this.stairGroups = [];
    this.events = [];
    this.obstacles = [];
    this.publishedGraph = {
      buildings: [],
      floors: [],
      nodes: [],
      edges: [],
      destinations: [],
      events: [],
      obstacles: [],
      stairGroups: [],
    };
    this.pendingChanges = [];
    this.undoStack = [];
    this.redoStack = [];
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("campusnav_working_store_v1");
        localStorage.removeItem("campusnav_published_store_v1");
        localStorage.removeItem("campusnav_working_store_v2");
        localStorage.removeItem("campusnav_published_store_v2");
      } catch (e) {}
    }
    this.saveSnapshotToUndo();
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }


  private isBatching = false;

  public startBatching() {
    if (!this.isBatching) {
      this.saveSnapshotToUndo();
      this.isBatching = true;
    }
  }

  public endBatching() {
    if (this.isBatching) {
      this.isBatching = false;
      this.notify();
    }
  }

  private notify() {
    if (this.isBatching) return;
    this.saveToLocalStorage();
    this.listeners.forEach((l) => l());
  }

  public saveSnapshotToUndo(description = "Graph Edit") {
    if (this.isBatching) return;
    const entry: UndoHistoryEntry = {
      id: `undo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      description,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        corridors: JSON.parse(JSON.stringify(this.corridors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    };
    this.undoStack.push(entry);
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  // ── Getters ──────────────────────────────────────────────

  public getPublishedVersion() {
    return this.publishedVersion;
  }

  public getWorkingData() {
    return {
      campus: this.campus,
      buildings: this.buildings,
      floors: this.floors,
      nodes: this.nodes,
      edges: this.edges,
      destinations: this.destinations,
      events: this.events,
      obstacles: this.obstacles,
      stairGroups: this.stairGroups,
      liftGroups: this.liftGroups,
      corridors: this.corridors,
      doors: this.doors,
      suggestedNodes: this.suggestedNodes,
      suggestedEdges: this.suggestedEdges,
    };
  }

  public getPublishedData() {
    const mergedObstacleMap = new Map<string, typeof this.obstacles[0]>();
    (this.publishedGraph.obstacles || []).forEach((o) => mergedObstacleMap.set(o.id, o));
    (this.obstacles || []).forEach((o) => mergedObstacleMap.set(o.id, o));
    const mergedObstacles = Array.from(mergedObstacleMap.values());

    const pub = {
      campus: this.campus,
      buildings: this.publishedGraph.buildings,
      floors: this.publishedGraph.floors,
      nodes: this.publishedGraph.nodes,
      edges: this.publishedGraph.edges,
      destinations: this.publishedGraph.destinations,
      events: this.publishedGraph.events,
      obstacles: mergedObstacles,
      stairGroups: this.publishedGraph.stairGroups || [],
      liftGroups: this.publishedGraph.liftGroups || [],
      corridors: this.publishedGraph.corridors || [],
    };
    if (
      (pub.nodes.length === 0 || pub.edges.length < this.edges.length) &&
      this.nodes.length > 0
    ) {
      return this.getWorkingData();
    }
    return pub;
  }

  public getPendingChanges() {
    return this.pendingChanges;
  }

  public canUndo() {
    return this.undoStack.length > 0;
  }

  public canRedo() {
    return this.redoStack.length > 0;
  }

  // ── Actions ──────────────────────────────────────────────

  public addBuilding(b: Building) {
    this.saveSnapshotToUndo(`Added Building "${b.name}"`);
    this.buildings.push(b);
    this.logAction("CREATE", `Building "${b.name}"`);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_BUILDING",
      entityType: "building",
      entityId: b.id,
      description: `Added Building "${b.name}" (${b.shortCode})`,
      timestamp: Date.now(),
      newData: b,
    });

    // Auto-create Ground Floor and basements / upper floors if defined
    const basements = b.basementsCount ?? 0;
    const upperFloors = b.floorsCount !== undefined ? b.floorsCount : 0; // Default ONLY Ground Floor (0 upper floors)

    for (let i = -basements; i <= upperFloors; i++) {
      const code = getFloorCode(i);
      const name = i < 0 ? `Basement ${Math.abs(i)}` : i === 0 ? "Ground Floor" : `Floor ${i}`;
      const fid = `f-${b.id}-${code.toLowerCase()}`;
      if (!this.floors.some((f) => f.id === fid)) {
        this.floors.push({
          id: fid,
          buildingId: b.id,
          name,
          ordinal: i,
          code,
        });
      }
    }

    this.redoStack = [];
    this.notify();
    return b;
  }

  public updateBuilding(id: string, patch: Partial<Building>, recordHistory = true) {
    const idx = this.buildings.findIndex((b) => b.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo(`Updated Building "${this.buildings[idx].name}"`);
    }
    const prev = { ...this.buildings[idx] };
    const oldX = prev.x ?? 0;
    const oldY = prev.y ?? 0;
    const oldW = prev.width ?? 180;
    const oldH = prev.height ?? 120;

    this.buildings[idx] = { ...this.buildings[idx], ...patch };
    const newX = this.buildings[idx].x ?? 0;
    const newY = this.buildings[idx].y ?? 0;
    const dx = newX - oldX;
    const dy = newY - oldY;

    // Move all child elements belonging to this building's floors, buildingId, stair/lift groups, or spatial bounds
    if (dx !== 0 || dy !== 0) {
      const buildingFloors = this.floors.filter((f) => f.buildingId === id);
      const buildingFloorIds = new Set(buildingFloors.map((f) => f.id));

      const buildingStairGroupIds = new Set(
        (this.stairGroups || []).filter((sg) => sg.buildingId === id).map((sg) => sg.id)
      );
      const buildingLiftGroupIds = new Set(
        (this.liftGroups || []).filter((lg) => lg.buildingId === id).map((lg) => lg.id)
      );

      // Bounding box with 20px margin to capture nodes/doors inside or on edges of building
      const margin = 20;
      const minX = oldX - margin;
      const maxX = oldX + oldW + margin;
      const minY = oldY - margin;
      const maxY = oldY + oldH + margin;

      const isNodeInBuilding = (n: Node) => {
        if (buildingFloorIds.has(n.floorId)) return true;
        if ((n as unknown as { buildingId?: string }).buildingId === id) return true;
        if (n.stairGroupId && buildingStairGroupIds.has(n.stairGroupId)) return true;
        if (n.liftGroupId && buildingLiftGroupIds.has(n.liftGroupId)) return true;
        if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) return true;
        return false;
      };

      // 1. Move all Nodes inside or associated with building
      this.nodes = this.nodes.map((n) => {
        if (isNodeInBuilding(n)) {
          const nx = n.x + dx;
          const ny = n.y + dy;
          const { lat, lng } = canvasToGps(nx, ny);
          return { ...n, x: nx, y: ny, lat, lng };
        }
        return n;
      });

      const movedNodeIds = new Set(this.nodes.filter(isNodeInBuilding).map((n) => n.id));

      // 2. Move all Doors inside or associated with building
      this.doors = this.doors.map((door) => {
        const belongs =
          buildingFloorIds.has(door.floorId) ||
          (door as unknown as { buildingId?: string }).buildingId === id ||
          (door.x >= minX && door.x <= maxX && door.y >= minY && door.y <= maxY);
        if (belongs) {
          return { ...door, x: door.x + dx, y: door.y + dy };
        }
        return door;
      });

      // 3. Move all Obstacles inside or associated with building
      this.obstacles = this.obstacles.map((obs) => {
        const belongs =
          (obs.floorId && buildingFloorIds.has(obs.floorId)) ||
          (obs.nodeId && movedNodeIds.has(obs.nodeId)) ||
          (obs.x >= minX && obs.x <= maxX && obs.y >= minY && obs.y <= maxY);
        if (belongs) {
          return { ...obs, x: obs.x + dx, y: obs.y + dy };
        }
        return obs;
      });

      // 4. Move all Corridors inside or associated with building
      this.corridors = this.corridors.map((c) => {
        const belongs =
          buildingFloorIds.has(c.floorId) ||
          c.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        if (belongs) {
          return {
            ...c,
            points: c.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          };
        }
        return c;
      });

      // 5. Move all Destinations inside or associated with building
      this.destinations = this.destinations.map((dest) => {
        const belongs =
          (dest.floorId && buildingFloorIds.has(dest.floorId)) ||
          (dest.nodeId && movedNodeIds.has(dest.nodeId)) ||
          (dest.x !== undefined && dest.y !== undefined && dest.x >= minX && dest.x <= maxX && dest.y >= minY && dest.y <= maxY);
        if (belongs) {
          return {
            ...dest,
            x: dest.x !== undefined ? dest.x + dx : undefined,
            y: dest.y !== undefined ? dest.y + dy : undefined,
          };
        }
        return dest;
      });

      // 6. Move all Events inside or associated with building
      this.events = this.events.map((ev) => {
        const belongs =
          ev.buildingId === id ||
          (ev.x !== undefined && ev.y !== undefined && ev.x >= minX && ev.x <= maxX && ev.y >= minY && ev.y <= maxY);
        if (belongs) {
          return {
            ...ev,
            buildingId: id,
            x: ev.x !== undefined ? ev.x + dx : undefined,
            y: ev.y !== undefined ? ev.y + dy : undefined,
          };
        }
        return ev;
      });
    }

    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_BUILDING",
        entityType: "building",
        entityId: id,
        description: `Updated Building "${this.buildings[idx].name}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.buildings[idx],
      });
    }
    this.notify();
  }

  public addFloor(floorOrBuildingId: Floor | string, name?: string, ordinal?: number, code?: string): Floor {
    let f: Floor;
    if (typeof floorOrBuildingId === "object") {
      f = floorOrBuildingId;
    } else {
      const ord = ordinal ?? 1;
      const defaultName =
        ord < 0
          ? ord === -1
            ? "Level -1 Basement"
            : `Basement ${Math.abs(ord)}`
          : ord === 0
          ? "Ground Floor"
          : `Floor ${ord}`;
      const defaultCode = getFloorCode(ord, name);
      f = {
        id: `f-${floorOrBuildingId}-${Date.now().toString(36)}`,
        buildingId: floorOrBuildingId,
        name: name || defaultName,
        ordinal: ord,
        code: code || defaultCode,
      };
    }
    this.saveSnapshotToUndo(`Added Floor "${f.name}"`);
    this.floors.push(f);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_FLOOR",
      entityType: "floor",
      entityId: f.id,
      description: `Added Floor "${f.name}" (Level ${f.ordinal})`,
      timestamp: Date.now(),
      newData: f,
    });
    this.notify();
    return f;
  }

  public updateFloor(id: string, patch: Partial<Floor>) {
    const idx = this.floors.findIndex((f) => f.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo(`Updated Floor "${this.floors[idx].name}"`);
    const prev = { ...this.floors[idx] };
    this.floors[idx] = { ...this.floors[idx], ...patch };

    if (this.publishedGraph.floors) {
      const pubIdx = this.publishedGraph.floors.findIndex((f) => f.id === id);
      if (pubIdx !== -1) {
        this.publishedGraph.floors[pubIdx] = { ...this.publishedGraph.floors[pubIdx], ...patch };
      }
    }

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "UPDATE_FLOOR",
      entityType: "floor",
      entityId: id,
      description: `Updated Floor "${this.floors[idx].name}"`,
      timestamp: Date.now(),
      prevData: prev,
      newData: this.floors[idx],
    });
    this.notify();
  }

  public loadSnapshot(snapshot: any) {
    if (!snapshot) return;
    this.saveSnapshotToUndo("Loaded Graph Snapshot");
    if (snapshot.buildings) this.buildings = snapshot.buildings;
    if (snapshot.floors) this.floors = snapshot.floors;
    if (snapshot.nodes) this.nodes = snapshot.nodes;
    if (snapshot.edges) this.edges = snapshot.edges;
    if (snapshot.destinations) this.destinations = snapshot.destinations;
    if (snapshot.events) this.events = snapshot.events;
    if (snapshot.obstacles) this.obstacles = snapshot.obstacles;
    this.notify();
  }

  // Smart Floor Duplication with selective copying
  public duplicateFloor(
    sourceFloorId: string,
    options: {
      copyRooms?: boolean;
      copyCorridors?: boolean;
      copyNodes?: boolean;
      copyEdges?: boolean;
      copyFacilities?: boolean;
      copyDestinations?: boolean;
      copyObstacles?: boolean;
    } = { copyNodes: true, copyEdges: true }
  ): Floor | undefined {
    const srcFloor = this.floors.find((f) => f.id === sourceFloorId);
    if (!srcFloor) return;

    this.saveSnapshotToUndo();
    const buildingFloors = this.floors.filter((f) => f.buildingId === srcFloor.buildingId);
    let nextOrdinal: number;
    let newFloorName: string;

    if (srcFloor.ordinal < 0) {
      const minOrdinal = Math.min(...buildingFloors.map((f) => f.ordinal), 0);
      nextOrdinal = Math.min(0, minOrdinal) - 1;
      newFloorName = nextOrdinal === -1 ? "Level -1 Basement" : `Basement ${Math.abs(nextOrdinal)}`;
    } else {
      const maxOrdinal = Math.max(...buildingFloors.map((f) => f.ordinal), 0);
      nextOrdinal = Math.max(0, maxOrdinal) + 1;
      newFloorName = `Floor ${nextOrdinal}`;
    }

    const newFloorId = `f-${srcFloor.buildingId}-${Date.now().toString(36)}`;

    const newFloor: Floor = {
      id: newFloorId,
      buildingId: srcFloor.buildingId,
      name: newFloorName,
      ordinal: nextOrdinal,
      code: getFloorCode(nextOrdinal, newFloorName),
    };
    this.floors.push(newFloor);

    // Map old node ID to new node ID for edge preservation
    const nodeIdMap = new Map<string, string>();

    // Copy nodes if selected
    if (options.copyNodes) {
      const srcNodes = this.nodes.filter((n) => n.floorId === sourceFloorId);
      srcNodes.forEach((n) => {
        // Skip facility / room filter if disabled
        if (n.type === "ROOM" && !options.copyRooms) return;
        if (n.type === "WASHROOM" && !options.copyFacilities) return;

        const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        nodeIdMap.set(n.id, newId);

        this.nodes.push({
          ...JSON.parse(JSON.stringify(n)),
          id: newId,
          floorId: newFloorId,
          name: n.name ? `${n.name} (Copy)` : undefined,
        });
      });
    }

    // Copy edges if selected
    if (options.copyEdges && options.copyNodes) {
      const srcEdges = this.edges.filter(
        (e) =>
          this.nodes.find((n) => n.id === e.from)?.floorId === sourceFloorId &&
          this.nodes.find((n) => n.id === e.to)?.floorId === sourceFloorId
      );
      srcEdges.forEach((e) => {
        const newFrom = nodeIdMap.get(e.from);
        const newTo = nodeIdMap.get(e.to);
        if (newFrom && newTo) {
          this.edges.push({
            ...JSON.parse(JSON.stringify(e)),
            id: `e-${newFrom}-${newTo}`,
            from: newFrom,
            to: newTo,
          });
        }
      });
    }

    // Copy destinations if selected
    if (options.copyDestinations && options.copyNodes) {
      const srcDests = this.destinations.filter((d) =>
        this.nodes.some((n) => n.id === d.nodeId && n.floorId === sourceFloorId)
      );
      srcDests.forEach((d) => {
        const newTargetNode = nodeIdMap.get(d.nodeId);
        if (newTargetNode) {
          this.destinations.push({
            ...JSON.parse(JSON.stringify(d)),
            id: `dest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            nodeId: newTargetNode,
            name: `${d.name} (Copy)`,
          });
        }
      });
    }

    // Copy obstacles if selected
    if (options.copyObstacles) {
      const srcObs = this.obstacles.filter((o) => o.floorId === sourceFloorId);
      srcObs.forEach((o) => {
        this.obstacles.push({
          ...JSON.parse(JSON.stringify(o)),
          id: `obs-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          floorId: newFloorId,
        });
      });
    }

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_FLOOR",
      entityType: "floor",
      entityId: newFloorId,
      description: `Smart Duplicated Floor "${srcFloor.name}" -> "${newFloorName}"`,
      timestamp: Date.now(),
      newData: newFloor,
    });

    this.notify();
    return newFloor;
  }

  public deleteBuilding(id: string) {
    const idx = this.buildings.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const deleted = this.buildings[idx];
    this.saveSnapshotToUndo(`Deleted Building "${deleted.name}"`);
    this.buildings.splice(idx, 1);

    const buildingFloorIds = new Set(this.floors.filter((f) => f.buildingId === id).map((f) => f.id));
    this.floors = this.floors.filter((f) => f.buildingId !== id);

    const deletedNodeIds = new Set(this.nodes.filter((n) => buildingFloorIds.has(n.floorId)).map((n) => n.id));
    this.nodes = this.nodes.filter((n) => !buildingFloorIds.has(n.floorId));
    this.edges = this.edges.filter((e) => !deletedNodeIds.has(e.from) && !deletedNodeIds.has(e.to));
    this.destinations = this.destinations.filter((d) => !deletedNodeIds.has(d.nodeId) && (!d.floorId || !buildingFloorIds.has(d.floorId)));
    this.doors = this.doors.filter((d) => !buildingFloorIds.has(d.floorId));
    this.corridors = this.corridors.filter((c) => !buildingFloorIds.has(c.floorId));
    this.obstacles = this.obstacles.filter((o) => !o.floorId || !buildingFloorIds.has(o.floorId));
    this.stairGroups = this.stairGroups.filter((sg) => sg.buildingId !== id);
    this.liftGroups = this.liftGroups.filter((lg) => lg.buildingId !== id);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_BUILDING",
      entityType: "building",
      entityId: id,
      description: `Deleted Building "${deleted.name}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });

    this.saveToLocalStorage();
    this.notify();
  }

  public deleteFloor(id: string) {
    const idx = this.floors.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const deleted = this.floors[idx];
    this.saveSnapshotToUndo(`Deleted Floor "${deleted.name}"`);
    this.floors.splice(idx, 1);

    const deletedNodeIds = new Set(this.nodes.filter((n) => n.floorId === id).map((n) => n.id));
    this.nodes = this.nodes.filter((n) => n.floorId !== id);
    this.edges = this.edges.filter((e) => !deletedNodeIds.has(e.from) && !deletedNodeIds.has(e.to));
    this.destinations = this.destinations.filter((d) => !deletedNodeIds.has(d.nodeId) && d.floorId !== id);
    this.doors = this.doors.filter((d) => d.floorId !== id);
    this.corridors = this.corridors.filter((c) => c.floorId !== id);
    this.obstacles = this.obstacles.filter((o) => o.floorId !== id);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_FLOOR",
      entityType: "floor",
      entityId: id,
      description: `Deleted Floor "${deleted.name}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public addNode(node: Node, autoSuggestConnections = false) {
    this.saveSnapshotToUndo(`Added ${node.type} Node "${node.name ?? node.id}"`);
    if (!node.lat || !node.lng) {
      node.lat = Number((12.9716 + ((node.y ?? 300) - 300) * 0.00001).toFixed(6));
      node.lng = Number((77.5946 + ((node.x ?? 400) - 400) * 0.00001).toFixed(6));
    }
    this.nodes.push(node);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_NODE",
      entityType: "node",
      entityId: node.id,
      description: `Added ${node.type} Node "${node.name ?? node.id}"`,
      timestamp: Date.now(),
      newData: node,
    });

    // Auto-suggest / connect to nearest adjacent nodes on same floor within threshold distance
    if (autoSuggestConnections) {
      const threshold = 180; // pixel/coord threshold
      const adjacent = this.nodes.filter((n) => {
        if (n.id === node.id || n.floorId !== node.floorId) return false;
        const dx = n.x - node.x;
        const dy = n.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= threshold;
      });

      // Auto-connect to closest 2 adjacent nodes if any
      adjacent
        .sort((a, b) => {
          const da = Math.hypot(a.x - node.x, a.y - node.y);
          const db = Math.hypot(b.x - node.x, b.y - node.y);
          return da - db;
        })
        .slice(0, 2)
        .forEach((target) => {
          const d = Math.round(Math.hypot(target.x - node.x, target.y - node.y) / 4);
          this.addEdgeInternal({
            id: `e-${node.id}-${target.id}`,
            from: node.id,
            to: target.id,
            type: "WALK",
            distance: d > 0 ? d : 10,
            bidirectional: true,
          });
        });
    }

    this.redoStack = [];
    this.notify();
  }

  public updateNode(id: string, patch: Partial<Node>, recordHistory = true) {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo(`Moved/Updated Node "${this.nodes[idx].name ?? id}"`);
    }
    const prev = { ...this.nodes[idx] };
    const updatedNode = { ...this.nodes[idx], ...patch };
    this.nodes[idx] = updatedNode;

    // If node belongs to a stair group or lift group, sync x and y across all nodes in the group
    const groupId = updatedNode.stairGroupId || updatedNode.liftGroupId;
    if (groupId && (patch.x !== undefined || patch.y !== undefined)) {
      const newX = patch.x !== undefined ? patch.x : updatedNode.x;
      const newY = patch.y !== undefined ? patch.y : updatedNode.y;
      this.nodes.forEach((n, i) => {
        if (i !== idx && (n.stairGroupId === groupId || n.liftGroupId === groupId)) {
          this.nodes[i] = {
            ...this.nodes[i],
            x: newX,
            y: newY,
          };
        }
      });
    }

    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_NODE",
        entityType: "node",
        entityId: id,
        description: `Moved/Updated Node "${this.nodes[idx].name ?? id}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.nodes[idx],
      });
    }
    this.notify();
  }

  public deleteNode(id: string) {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const deleted = this.nodes[idx];
    this.saveSnapshotToUndo(`Deleted Node "${deleted.name ?? id}"`);
    this.nodes.splice(idx, 1);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.destinations = this.destinations.filter((d) => d.nodeId !== id);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_NODE",
      entityType: "node",
      entityId: id,
      description: `Deleted Node "${deleted.name ?? id}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public deleteEdge(id: string) {
    const baseId = id.replace(/_rev$/, "");
    const targetEdge = this.edges.find((e) => e.id === id || e.id === baseId || e.id === `${baseId}_rev`);
    if (!targetEdge) return;

    const fromId = targetEdge.from;
    const toId = targetEdge.to;

    this.saveSnapshotToUndo(`Deleted Edge "${id}"`);
    this.edges = this.edges.filter(
      (e) =>
        e.id !== id &&
        e.id !== baseId &&
        e.id !== `${baseId}_rev` &&
        !(e.from === fromId && e.to === toId) &&
        !(e.from === toId && e.to === fromId)
    );

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_EDGE",
      entityType: "edge",
      entityId: id,
      description: `Deleted Edge "${id}"`,
      timestamp: Date.now(),
      prevData: targetEdge,
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public deleteDestination(id: string) {
    const idx = this.destinations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    const deleted = this.destinations[idx];
    this.saveSnapshotToUndo(`Deleted Destination "${deleted.name}"`);
    this.destinations.splice(idx, 1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_DESTINATION",
      entityType: "destination",
      entityId: id,
      description: `Deleted Destination "${deleted.name}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public deleteObstacle(id: string) {
    const idx = this.obstacles.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const deleted = this.obstacles[idx];
    this.saveSnapshotToUndo(`Deleted Obstacle "${deleted.reason ?? id}"`);
    this.obstacles.splice(idx, 1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_OBSTACLE",
      entityType: "obstacle",
      entityId: id,
      description: `Deleted Obstacle "${deleted.reason ?? id}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public deleteEvent(id: string) {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const deleted = this.events[idx];
    this.saveSnapshotToUndo(`Deleted Event "${deleted.title}"`);
    this.events.splice(idx, 1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_EVENT",
      entityType: "event",
      entityId: id,
      description: `Deleted Event "${deleted.title}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public clearAll() {
    this.saveSnapshotToUndo("Cleared All Campus Graph Elements");
    this.buildings = [];
    this.floors = [];
    this.nodes = [];
    this.edges = [];
    this.destinations = [];
    this.events = [];
    this.obstacles = [];
    this.stairGroups = [];
    this.liftGroups = [];
    this.corridors = [];
    this.doors = [];
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "BULK_DELETE",
      entityType: "node",
      entityId: "all",
      description: "Cleared all campus graph elements",
      timestamp: Date.now(),
    });
    this.saveToLocalStorage();
    this.notify();
  }

  public duplicateNode(nodeId: string): Node | undefined {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.saveSnapshotToUndo(`Duplicated Node "${node.name ?? nodeId}"`);
    const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const copy: Node = {
      ...JSON.parse(JSON.stringify(node)),
      id: newId,
      x: node.x + 20,
      y: node.y + 20,
      name: node.name ? `${node.name} (Copy)` : undefined,
    };
    this.nodes.push(copy);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_NODE",
      entityType: "node",
      entityId: newId,
      description: `Duplicated Node "${node.name ?? nodeId}"`,
      timestamp: Date.now(),
      newData: copy,
    });
    this.notify();
    return copy;
  }

  public disconnectNode(nodeId: string) {
    this.saveSnapshotToUndo(`Disconnected Node "${nodeId}"`);
    this.edges = this.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    this.notify();
  }

  // ── Stair Group System ──────────────────────────────────

  public createStairGroup(
    buildingId: string,
    name: string,
    connectedFloorIds: string[],
    pos?: { x: number; y: number }
  ): StairGroup {
    const groupName = name.trim() || "Staircase A";
    const groupId = `stairgroup-${Date.now().toString(36)}`;
    this.saveSnapshotToUndo(`Created Staircase Group "${groupName}"`);

    let targetPos = pos;
    if (!targetPos) {
      const b = this.buildings.find((item) => item.id === buildingId);
      if (b) {
        targetPos = { x: (b.x ?? 0) + (b.width ?? 180) / 2, y: (b.y ?? 0) + (b.height ?? 120) / 2 };
      } else {
        targetPos = { x: 300, y: 300 };
      }
    }

    const stairGroup: StairGroup = {
      id: groupId,
      buildingId,
      name: groupName,
      connectedFloorIds,
    };
    this.stairGroups.push(stairGroup);

    this.rebuildStairGroupConnections(stairGroup, targetPos);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_STAIR_GROUP",
      entityType: "stairGroup",
      entityId: groupId,
      description: `Created Stair Group "${groupName}" connecting ${connectedFloorIds.length} floors`,
      timestamp: Date.now(),
      newData: stairGroup,
    });

    this.notify();
    return stairGroup;
  }

  public updateStairGroup(groupId: string, patch: Partial<StairGroup>, pos?: { x: number; y: number }) {
    const idx = this.stairGroups.findIndex((sg) => sg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.stairGroups[idx] = { ...this.stairGroups[idx], ...patch };
    this.rebuildStairGroupConnections(this.stairGroups[idx], pos);
    this.notify();
  }

  public deleteStairGroup(groupId: string) {
    const idx = this.stairGroups.findIndex((sg) => sg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const deleted = this.stairGroups[idx];
    this.stairGroups.splice(idx, 1);
    // Delete all nodes and edges belonging to this stair group
    this.nodes = this.nodes.filter((n) => n.stairGroupId !== groupId);
    this.edges = this.edges.filter((e) => e.stairGroupId !== groupId);
    this.notify();
  }

  public autoConnectVerticalNodesToFloor(radiusThreshold = 1000) {
    // First, auto-link vertical nodes (stairs/lifts) across floors if created manually or missing stairGroupId edges
    this.autoConnectMatchingVerticalNodesAcrossFloors();

    const verticalNodes = this.nodes.filter(
      (n) => n.stairGroupId || n.liftGroupId || n.type === "STAIR" || n.type === "LIFT"
    );

    let createdAny = false;

    verticalNodes.forEach((vNode) => {
      const vFloorObj = this.floors.find((f) => f.id === vNode.floorId);
      const isVNodeGround = vNode.floorId === "f-out" || vFloorObj?.ordinal === 0;

      // Find candidate nodes on the same floor level (combining Ground Floor + Outdoor for level 0)
      const candidates = this.nodes.filter((n) => {
        if (n.id === vNode.id) return false;
        if (n.stairGroupId && n.stairGroupId === vNode.stairGroupId) return false;
        if (n.liftGroupId && n.liftGroupId === vNode.liftGroupId) return false;

        const nFloorObj = this.floors.find((f) => f.id === n.floorId);
        const isNGround = n.floorId === "f-out" || nFloorObj?.ordinal === 0;

        if (isVNodeGround && isNGround) return true;
        return n.floorId === vNode.floorId;
      });

      if (candidates.length === 0) return;

      // Check existing horizontal connections
      const existingHorizontalEdges = this.edges.filter((e) => {
        if (e.from !== vNode.id && e.to !== vNode.id) return false;
        const otherId = e.from === vNode.id ? e.to : e.from;
        const otherNode = this.nodes.find((mn) => mn.id === otherId);
        return otherNode && e.type !== "STAIRS" && e.type !== "LIFT";
      });

      const mapped = candidates
        .map((cand) => ({ node: cand, dist: Math.hypot(cand.x - vNode.x, cand.y - vNode.y) }))
        .sort((a, b) => a.dist - b.dist);

      let targetsToConnect: typeof mapped = [];

      // If disconnected (0 horizontal edges), guarantee connection to the 2 closest floor nodes regardless of distance!
      if (existingHorizontalEdges.length === 0) {
        targetsToConnect = mapped.slice(0, 2);
      } else {
        targetsToConnect = mapped.filter((item) => item.dist <= radiusThreshold).slice(0, 2);
      }

      targetsToConnect.forEach(({ node: cand, dist }) => {
        const targetId = cand.id;
        const hasEdge = this.edges.some(
          (e) => (e.from === vNode.id && e.to === targetId) || (e.from === targetId && e.to === vNode.id)
        );

        if (!hasEdge) {
          const edgeId = `e-autoconn-${vNode.id}-${targetId}`;
          const calcDist = Math.max(1, Math.round(dist / 4));
          this.addEdgeInternal({
            id: edgeId,
            from: vNode.id,
            to: targetId,
            type: "WALK",
            distance: calcDist,
            bidirectional: true,
          });
          createdAny = true;
        }
      });
    });

    if (createdAny) {
      this.saveToLocalStorage();
      this.notify();
    }
  }

  public autoConnectFloorToOutdoorOrGround(
    sourceFloorId: string,
    type: EdgeType = "WALK"
  ): { success: boolean; description?: string; error?: string } {
    const srcFloor = this.floors.find((f) => f.id === sourceFloorId);
    if (!srcFloor) return { success: false, error: "Floor not found" };

    const srcNodes = this.nodes.filter((n) => n.floorId === sourceFloorId);
    if (srcNodes.length === 0) {
      return { success: false, error: `No nodes exist on "${srcFloor.name}" yet. Place a node or room first.` };
    }

    // Find outdoor / ground floor candidate nodes
    const targetNodes = this.nodes.filter((n) => {
      if (n.floorId === sourceFloorId) return false;
      if (n.floorId === "f-out") return true;
      const fl = this.floors.find((f) => f.id === n.floorId);
      return fl?.ordinal === 0 || n.isEntranceNode || n.type === "BUILDING_ENTRANCE" || n.type === "CORRIDOR" || n.type === "ENTRANCE";
    });

    if (targetNodes.length === 0) {
      return { success: false, error: "No outdoor or ground floor nodes found to connect to." };
    }

    // Find closest pair of nodes between source floor and target nodes
    let minDistance = Infinity;
    let bestPair: { fromNode: Node; toNode: Node; dist: number } | null = null;

    srcNodes.forEach((sNode) => {
      targetNodes.forEach((tNode) => {
        const dist = Math.hypot(sNode.x - tNode.x, sNode.y - tNode.y);
        if (dist < minDistance) {
          minDistance = dist;
          bestPair = { fromNode: sNode, toNode: tNode, dist };
        }
      });
    });

    if (!bestPair) return { success: false, error: "Could not calculate connecting path." };

    const pair = bestPair as { fromNode: Node; toNode: Node; dist: number };
    const calcDist = Math.max(1, Math.round(pair.dist / 4));
    const edgeId = `e-floorlink-${pair.fromNode.id}-${pair.toNode.id}`;

    const res = this.addEdge({
      id: edgeId,
      from: pair.fromNode.id,
      to: pair.toNode.id,
      type,
      distance: calcDist,
      bidirectional: true,
    });

    if (res.success) {
      return {
        success: true,
        description: `Linked "${pair.fromNode.name || "Node"}" (${srcFloor.name}) to "${pair.toNode.name || "Node"}" via ${type} path (${calcDist}m).`,
      };
    }
    return res;
  }

  public autoConnectMatchingVerticalNodesAcrossFloors() {
    const stairNodes = this.nodes.filter((n) => n.type === "STAIR" || n.stairGroupId);
    const groupMap = new Map<string, Node[]>();

    stairNodes.forEach((n) => {
      // Group strictly by explicit stairGroupId or exact matching stair name
      const nameKey = (n.name || "")
        .replace(/\s*\([^)]*\)/g, "")
        .trim()
        .toLowerCase();
      const key = n.stairGroupId || (nameKey.length > 0 ? nameKey : null);

      if (key) {
        const list = groupMap.get(key) || [];
        list.push(n);
        groupMap.set(key, list);
      }
    });

    let createdAny = false;

    groupMap.forEach((nodesInGroup) => {
      if (nodesInGroup.length >= 2) {
        nodesInGroup.sort((a, b) => {
          const fA = this.floors.find((f) => f.id === a.floorId)?.ordinal ?? 0;
          const fB = this.floors.find((f) => f.id === b.floorId)?.ordinal ?? 0;
          return fA - fB;
        });

        for (let i = 0; i < nodesInGroup.length - 1; i++) {
          const from = nodesInGroup[i];
          const to = nodesInGroup[i + 1];
          if (from.floorId !== to.floorId) {
            const hasEdge = this.edges.some(
              (e) => (e.from === from.id && e.to === to.id) || (e.from === to.id && e.to === from.id)
            );
            if (!hasEdge) {
              const edgeId = `e-stair-auto-${from.id}-${to.id}`;
              this.addEdgeInternal({
                id: edgeId,
                from: from.id,
                to: to.id,
                type: "STAIRS",
                distance: 15,
                bidirectional: true,
              });
              createdAny = true;
            }
          }
        }
      }
    });

    if (createdAny) {
      this.saveToLocalStorage();
      this.notify();
    }
  }

  private syncVerticalGroupPositions() {
    this.stairGroups.forEach((sg) => {
      const groupNodes = this.nodes.filter((n) => n.stairGroupId === sg.id);
      if (groupNodes.length > 0) {
        const refX = groupNodes[0].x;
        const refY = groupNodes[0].y;
        groupNodes.forEach((n) => {
          n.x = refX;
          n.y = refY;
        });
      }
    });

    this.liftGroups.forEach((lg) => {
      const groupNodes = this.nodes.filter((n) => n.liftGroupId === lg.id);
      if (groupNodes.length > 0) {
        const refX = groupNodes[0].x;
        const refY = groupNodes[0].y;
        groupNodes.forEach((n) => {
          n.x = refX;
          n.y = refY;
        });
      }
    });
  }

  private rebuildStairGroupConnections(group: StairGroup, basePos?: { x: number; y: number }) {
    // Get ordered floors
    const buildingFloors = this.floors
      .filter((f) => group.connectedFloorIds.includes(f.id))
      .sort((a, b) => a.ordinal - b.ordinal);

    const existingNode = this.nodes.find((n) => n.stairGroupId === group.id);
    const refX = basePos?.x ?? existingNode?.x ?? 300;
    const refY = basePos?.y ?? existingNode?.y ?? 300;

    // Ensure stair node exists on each connected floor with matching (x, y) coordinates
    const createdNodes: Node[] = [];
    buildingFloors.forEach((fl) => {
      let node = this.nodes.find((n) => n.stairGroupId === group.id && n.floorId === fl.id);
      if (!node) {
        node = {
          id: `stair-node-${group.id}-${fl.id}`,
          type: "STAIR",
          name: `${group.name} (${fl.name})`,
          floorId: fl.id,
          x: refX,
          y: refY,
          stairGroupId: group.id,
        };
        this.nodes.push(node);
      } else {
        node.x = refX;
        node.y = refY;
      }
      createdNodes.push(node);
    });

    // Remove stair nodes on floors no longer connected to this group
    this.nodes = this.nodes.filter(
      (n) => n.stairGroupId !== group.id || group.connectedFloorIds.includes(n.floorId)
    );

    // Remove existing vertical stair edges for this group and recreate consecutive links
    this.edges = this.edges.filter((e) => e.stairGroupId !== group.id);
    for (let i = 0; i < createdNodes.length - 1; i++) {
      const fromNode = createdNodes[i];
      const toNode = createdNodes[i + 1];
      const edgeId = `e-stair-${fromNode.id}-${toNode.id}`;
      this.addEdgeInternal({
        id: edgeId,
        from: fromNode.id,
        to: toNode.id,
        type: "STAIRS",
        distance: 15,
        bidirectional: true,
        stairGroupId: group.id,
      });
    }

    // Consecutive vertical stair edges created without auto-connecting to floor nodes
  }

  // ── Lift Group System ───────────────────────────────────

  public createLiftGroup(
    buildingId: string,
    name: string,
    servedFloorIds: string[],
    pos?: { x: number; y: number }
  ): LiftGroup {
    this.saveSnapshotToUndo();
    const groupId = `liftgroup-${Date.now().toString(36)}`;
    const groupName = name.trim() || "Elevator 1";

    let targetPos = pos;
    if (!targetPos) {
      const b = this.buildings.find((item) => item.id === buildingId);
      if (b) {
        targetPos = { x: (b.x ?? 0) + (b.width ?? 180) / 2, y: (b.y ?? 0) + (b.height ?? 120) / 2 };
      } else {
        targetPos = { x: 350, y: 350 };
      }
    }

    const liftGroup: LiftGroup = {
      id: groupId,
      buildingId,
      name: groupName,
      servedFloorIds,
      isAccessible: true,
    };
    this.liftGroups.push(liftGroup);

    this.rebuildLiftGroupConnections(liftGroup, targetPos);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_LIFT_GROUP",
      entityType: "liftGroup",
      entityId: groupId,
      description: `Created Lift Group "${groupName}" serving ${servedFloorIds.length} floors`,
      timestamp: Date.now(),
      newData: liftGroup,
    });

    this.notify();
    return liftGroup;
  }

  public updateLiftGroup(groupId: string, patch: Partial<LiftGroup>, pos?: { x: number; y: number }) {
    const idx = this.liftGroups.findIndex((lg) => lg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.liftGroups[idx] = { ...this.liftGroups[idx], ...patch };
    this.rebuildLiftGroupConnections(this.liftGroups[idx], pos);
    this.notify();
  }

  public deleteLiftGroup(groupId: string) {
    const idx = this.liftGroups.findIndex((lg) => lg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.liftGroups.splice(idx, 1);
    this.nodes = this.nodes.filter((n) => n.liftGroupId !== groupId);
    this.edges = this.edges.filter((e) => e.liftGroupId !== groupId);
    this.notify();
  }

  private rebuildLiftGroupConnections(group: LiftGroup, basePos?: { x: number; y: number }) {
    const buildingFloors = this.floors
      .filter((f) => group.servedFloorIds.includes(f.id))
      .sort((a, b) => a.ordinal - b.ordinal);

    const existingNode = this.nodes.find((n) => n.liftGroupId === group.id);
    const refX = basePos?.x ?? existingNode?.x ?? 350;
    const refY = basePos?.y ?? existingNode?.y ?? 350;

    const createdNodes: Node[] = [];
    buildingFloors.forEach((fl) => {
      let node = this.nodes.find((n) => n.liftGroupId === group.id && n.floorId === fl.id);
      if (!node) {
        node = {
          id: `lift-node-${group.id}-${fl.id}`,
          type: "LIFT",
          name: `${group.name} (${fl.name})`,
          floorId: fl.id,
          x: refX,
          y: refY,
          liftGroupId: group.id,
        };
        this.nodes.push(node);
      } else {
        node.x = refX;
        node.y = refY;
      }
      createdNodes.push(node);
    });

    this.nodes = this.nodes.filter(
      (n) => n.liftGroupId !== group.id || group.servedFloorIds.includes(n.floorId)
    );

    this.edges = this.edges.filter((e) => e.liftGroupId !== group.id);
    for (let i = 0; i < createdNodes.length - 1; i++) {
      const fromNode = createdNodes[i];
      const toNode = createdNodes[i + 1];
      const edgeId = `e-lift-${fromNode.id}-${toNode.id}`;
      this.addEdgeInternal({
        id: edgeId,
        from: fromNode.id,
        to: toNode.id,
        type: "LIFT",
        distance: 10,
        bidirectional: true,
        liftGroupId: group.id,
      });
    }

    // Consecutive vertical lift edges created without auto-connecting to floor nodes
  }



  public addEdge(edge: Edge): { success: boolean; error?: string } {
    // Validate duplicate edge
    const exists = this.edges.some(
      (e) =>
        (e.from === edge.from && e.to === edge.to) ||
        (e.bidirectional && e.from === edge.to && e.to === edge.from),
    );
    if (exists) {
      return { success: false, error: "Edge connection already exists between these nodes." };
    }

    this.saveSnapshotToUndo();
    this.addEdgeInternal(edge);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EDGE",
      entityType: "edge",
      entityId: edge.id,
      description: `Connected Edge (${edge.from} ↔ ${edge.to})`,
      timestamp: Date.now(),
      newData: edge,
    });
    this.redoStack = [];
    this.notify();
    return { success: true };
  }

  private addEdgeInternal(edge: Edge) {
    this.edges.push(edge);
    if (edge.bidirectional) {
      const revId = `e-${edge.to}-${edge.from}`;
      if (!this.edges.some((e) => e.id === revId)) {
        this.edges.push({
          id: revId,
          from: edge.to,
          to: edge.from,
          type: edge.type,
          distance: edge.distance,
          bidirectional: true,
        });
      }
    }
  }

  public updateEdge(id: string, patch: Partial<Edge>) {
    const idx = this.edges.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const prev = { ...this.edges[idx] };
    this.edges[idx] = { ...this.edges[idx], ...patch };
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "UPDATE_EDGE",
      entityType: "edge",
      entityId: id,
      description: `Updated Edge "${id}"`,
      timestamp: Date.now(),
      prevData: prev,
      newData: this.edges[idx],
    });
    this.notify();
  }

  public splitEdgeWithNode(edgeId: string, x: number, y: number, type: NodeType, name?: string) {
    const baseId = edgeId.replace(/_rev$/, "");
    const edge = this.edges.find((e) => e.id === edgeId || e.id === baseId);
    if (!edge) return null;

    const fromNode = this.nodes.find((n) => n.id === edge.from);
    const toNode = this.nodes.find((n) => n.id === edge.to);
    if (!fromNode || !toNode) return null;

    this.startBatching();

    const newNodeId = `n-${Date.now().toString(36)}`;
    const { lat, lng } = canvasToGps(x, y);
    const newNode: Node = {
      id: newNodeId,
      type,
      name: name || undefined,
      floorId: fromNode.floorId,
      x,
      y,
      lat,
      lng,
      searchable: true,
    };
    this.nodes.push(newNode);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_NODE",
      entityType: "node",
      entityId: newNodeId,
      description: `Added split node on edge at (${x}, ${y})`,
      timestamp: Date.now(),
      newData: newNode,
    });

    this.edges = this.edges.filter(
      (e) =>
        e.id !== edge.id &&
        e.id !== baseId &&
        e.id !== `${baseId}_rev` &&
        !(e.from === edge.from && e.to === edge.to) &&
        !(e.from === edge.to && e.to === edge.from)
    );

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_EDGE",
      entityType: "edge",
      entityId: edge.id,
      description: `Deleted split edge "${edge.id}"`,
      timestamp: Date.now(),
      prevData: edge,
    });

    const dist1 = Math.max(1, Math.round(Math.hypot(fromNode.x - x, fromNode.y - y) / 4));
    const dist2 = Math.max(1, Math.round(Math.hypot(toNode.x - x, toNode.y - y) / 4));

    const edge1: Edge = {
      id: `e-${fromNode.id}-${newNodeId}`,
      from: fromNode.id,
      to: newNodeId,
      type: edge.type,
      distance: dist1,
      bidirectional: edge.bidirectional,
    };
    const edge2: Edge = {
      id: `e-${newNodeId}-${toNode.id}`,
      from: newNodeId,
      to: toNode.id,
      type: edge.type,
      distance: dist2,
      bidirectional: edge.bidirectional,
    };

    this.addEdgeInternal(edge1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EDGE",
      entityType: "edge",
      entityId: edge1.id,
      description: `Connected Edge (${edge1.from} ↔ ${edge1.to})`,
      timestamp: Date.now(),
      newData: edge1,
    });

    this.addEdgeInternal(edge2);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EDGE",
      entityType: "edge",
      entityId: edge2.id,
      description: `Connected Edge (${edge2.from} ↔ ${edge2.to})`,
      timestamp: Date.now(),
      newData: edge2,
    });

    this.endBatching();
    return newNodeId;
  }

  public addDestination(d: Destination) {
    this.saveSnapshotToUndo();
    this.destinations.push(d);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_DESTINATION",
      entityType: "destination",
      entityId: d.id,
      description: `Added Destination "${d.name}"`,
      timestamp: Date.now(),
      newData: d,
    });
    this.redoStack = [];
    this.notify();
  }

  public updateDestination(id: string, patch: Partial<Destination>, recordHistory = true) {
    const idx = this.destinations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo();
    }
    const prev = { ...this.destinations[idx] };
    this.destinations[idx] = { ...this.destinations[idx], ...patch };

    // Synchronize linked node name if room name changed
    if (patch.name !== undefined) {
      const linkedNodeId = this.destinations[idx].nodeId;
      if (linkedNodeId) {
        const nodeIdx = this.nodes.findIndex((n) => n.id === linkedNodeId);
        if (nodeIdx !== -1) {
          this.nodes[nodeIdx].name = patch.name;
        }
      }
    }

    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_DESTINATION",
        entityType: "destination",
        entityId: id,
        description: `Updated Destination "${this.destinations[idx].name}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.destinations[idx],
      });
    }
    this.notify();
  }

  // ── Event Actions ───────────────────────────────────────

  public addEvent(ev: Event) {
    this.saveSnapshotToUndo();
    this.events.push(ev);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EVENT",
      entityType: "event",
      entityId: ev.id,
      description: `Added Campus Event "${ev.title}"`,
      timestamp: Date.now(),
      newData: ev,
    });
    this.redoStack = [];
    this.notify();
  }

  public updateEvent(id: string, patch: Partial<Event>) {
    const idx = this.events.findIndex((ev) => ev.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const prev = { ...this.events[idx] };
    this.events[idx] = { ...this.events[idx], ...patch };
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "UPDATE_EVENT",
      entityType: "event",
      entityId: id,
      description: `Updated Campus Event "${this.events[idx].title}"`,
      timestamp: Date.now(),
      prevData: prev,
      newData: this.events[idx],
    });
    this.notify();
  }

  // ── Obstacle Actions ─────────────────────────────────────

  public addObstacle(obs: Obstacle) {
    this.saveSnapshotToUndo();
    this.obstacles.push(obs);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_OBSTACLE",
      entityType: "obstacle",
      entityId: obs.id,
      description: `Added Obstacle "${obs.reason ?? obs.id}" (${obs.radius}m)`,
      timestamp: Date.now(),
      newData: obs,
    });
    this.redoStack = [];
    this.notify();
  }

  public updateObstacle(id: string, patch: Partial<Obstacle>, recordHistory = true) {
    const idx = this.obstacles.findIndex((obs) => obs.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo();
    }
    const prev = { ...this.obstacles[idx] };
    this.obstacles[idx] = { ...this.obstacles[idx], ...patch };
    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_OBSTACLE",
        entityType: "obstacle",
        entityId: id,
        description: `Updated Obstacle "${this.obstacles[idx].reason ?? id}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.obstacles[idx],
      });
    }
    this.notify();
  }

  public undo(): { success: boolean; description?: string } {
    if (this.undoStack.length === 0) return { success: false };
    const targetEntry = this.undoStack.pop()!;
    this.redoStack.push({
      id: `redo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      description: targetEntry.description,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        corridors: JSON.parse(JSON.stringify(this.corridors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    });

    const s = targetEntry.snapshot;
    this.buildings = JSON.parse(JSON.stringify(s.buildings));
    this.floors = JSON.parse(JSON.stringify(s.floors));
    this.nodes = JSON.parse(JSON.stringify(s.nodes));
    this.edges = JSON.parse(JSON.stringify(s.edges));
    this.destinations = JSON.parse(JSON.stringify(s.destinations));
    this.events = JSON.parse(JSON.stringify(s.events ?? []));
    this.obstacles = JSON.parse(JSON.stringify(s.obstacles ?? []));
    this.stairGroups = JSON.parse(JSON.stringify(s.stairGroups ?? []));
    this.liftGroups = JSON.parse(JSON.stringify(s.liftGroups ?? []));
    this.doors = JSON.parse(JSON.stringify(s.doors ?? []));
    this.corridors = JSON.parse(JSON.stringify(s.corridors ?? []));
    if (s.pendingChanges) {
      this.pendingChanges = JSON.parse(JSON.stringify(s.pendingChanges));
    }
    this.notify();
    return { success: true, description: targetEntry.description };
  }

  public redo(): { success: boolean; description?: string } {
    if (this.redoStack.length === 0) return { success: false };
    const targetEntry = this.redoStack.pop()!;
    this.undoStack.push({
      id: `undo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      description: targetEntry.description,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        corridors: JSON.parse(JSON.stringify(this.corridors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    });

    const s = targetEntry.snapshot;
    this.buildings = JSON.parse(JSON.stringify(s.buildings));
    this.floors = JSON.parse(JSON.stringify(s.floors));
    this.nodes = JSON.parse(JSON.stringify(s.nodes));
    this.edges = JSON.parse(JSON.stringify(s.edges));
    this.destinations = JSON.parse(JSON.stringify(s.destinations));
    this.events = JSON.parse(JSON.stringify(s.events ?? []));
    this.obstacles = JSON.parse(JSON.stringify(s.obstacles ?? []));
    this.stairGroups = JSON.parse(JSON.stringify(s.stairGroups ?? []));
    this.liftGroups = JSON.parse(JSON.stringify(s.liftGroups ?? []));
    this.doors = JSON.parse(JSON.stringify(s.doors ?? []));
    this.corridors = JSON.parse(JSON.stringify(s.corridors ?? []));
    if (s.pendingChanges) {
      this.pendingChanges = JSON.parse(JSON.stringify(s.pendingChanges));
    }
    this.notify();
    return { success: true, description: targetEntry.description };
  }

  public getUndoCount() {
    return this.undoStack.length;
  }

  public getRedoCount() {
    return this.redoStack.length;
  }

  public getUndoHistory() {
    return this.undoStack.map((e) => ({
      id: e.id,
      description: e.description,
      timestamp: e.timestamp,
    }));
  }

  public getRedoHistory() {
    return this.redoStack.map((e) => ({
      id: e.id,
      description: e.description,
      timestamp: e.timestamp,
    }));
  }

  public getLatestUndoDescription(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  public getLatestRedoDescription(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  public jumpToUndoStep(targetIndexFromEnd: number) {
    if (targetIndexFromEnd <= 0 || targetIndexFromEnd > this.undoStack.length) return;
    let lastDesc = "";
    const steps = this.undoStack.length - targetIndexFromEnd + 1;
    for (let i = 0; i < steps; i++) {
      const res = this.undo();
      if (res.description) lastDesc = res.description;
    }
    return lastDesc;
  }

  public discardPendingChange(changeId: string) {
    this.pendingChanges = this.pendingChanges.filter((c) => c.id !== changeId);
    this.notify();
  }

  public publish() {
    // Commit working draft graph to published graph
    this.publishedGraph = {
      buildings: JSON.parse(JSON.stringify(this.buildings)),
      floors: JSON.parse(JSON.stringify(this.floors)),
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      edges: JSON.parse(JSON.stringify(this.edges)),
      destinations: JSON.parse(JSON.stringify(this.destinations)),
      events: JSON.parse(JSON.stringify(this.events)),
      obstacles: JSON.parse(JSON.stringify(this.obstacles)),
      stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
      liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
      doors: JSON.parse(JSON.stringify(this.doors)),
      corridors: JSON.parse(JSON.stringify(this.corridors)),
    };
    const major = parseInt(this.publishedVersion.replace("v", "")) || 1;
    const minor = this.pendingChanges.length;
    this.publishedVersion = `v${major}.${minor > 0 ? minor : 1}`;
    this.logAction("PUBLISH", `Map ${this.publishedVersion} (${this.buildings.length} Buildings)`);
    this.pendingChanges = [];
    this.notify();
    return { version: this.publishedVersion, count: this.buildings.length };
  }

  // ── Named Checkpoints ────────────────────────────────────

  public createCheckpoint(name: string): Checkpoint {
    const cp: Checkpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || `Checkpoint ${this.checkpoints.length + 1}`,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        corridors: JSON.parse(JSON.stringify(this.corridors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    };
    this.checkpoints.unshift(cp);
    this.saveToLocalStorage();
    this.notify();
    return cp;
  }

  public updateCheckpoint(checkpointId: string, customName?: string): boolean {
    const idx = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx === -1) return false;
    this.saveSnapshotToUndo();
    this.checkpoints[idx] = {
      ...this.checkpoints[idx],
      name: customName ? customName.trim() : this.checkpoints[idx].name,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        corridors: JSON.parse(JSON.stringify(this.corridors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    };
    this.saveToLocalStorage();
    this.notify();
    return true;
  }

  public getCheckpoints(): Checkpoint[] {
    return this.checkpoints;
  }

  public restoreCheckpoint(checkpointId: string): boolean {
    const cp = this.checkpoints.find((c) => c.id === checkpointId);
    if (!cp) return false;
    this.saveSnapshotToUndo();
    this.buildings = JSON.parse(JSON.stringify(cp.snapshot.buildings));
    this.floors = JSON.parse(JSON.stringify(cp.snapshot.floors));
    this.nodes = JSON.parse(JSON.stringify(cp.snapshot.nodes));
    this.edges = JSON.parse(JSON.stringify(cp.snapshot.edges));
    this.destinations = JSON.parse(JSON.stringify(cp.snapshot.destinations));
    this.events = JSON.parse(JSON.stringify(cp.snapshot.events ?? []));
    this.obstacles = JSON.parse(JSON.stringify(cp.snapshot.obstacles ?? []));
    this.stairGroups = JSON.parse(JSON.stringify(cp.snapshot.stairGroups ?? []));
    this.liftGroups = JSON.parse(JSON.stringify(cp.snapshot.liftGroups ?? []));
    this.doors = JSON.parse(JSON.stringify(cp.snapshot.doors ?? []));
    this.corridors = JSON.parse(JSON.stringify(cp.snapshot.corridors ?? []));
    if (cp.snapshot.pendingChanges) {
      this.pendingChanges = JSON.parse(JSON.stringify(cp.snapshot.pendingChanges));
    }
    this.logAction("UPDATE", `Restored Checkpoint "${cp.name}"`);
    this.saveToLocalStorage();
    this.notify();
    return true;
  }

  // ── Corridor Management ──────────────────────────────────
  public addCorridor(corr: Corridor): Corridor {
    this.saveSnapshotToUndo();
    this.corridors.push(corr);
    this.generateGraphSuggestions(corr.floorId);
    this.notify();
    return corr;
  }

  public updateCorridor(id: string, patch: Partial<Corridor>) {
    const idx = this.corridors.findIndex((c) => c.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.corridors[idx] = { ...this.corridors[idx], ...patch };
    this.generateGraphSuggestions(this.corridors[idx].floorId);
    this.notify();
  }

  public deleteCorridor(id: string) {
    const idx = this.corridors.findIndex((c) => c.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const deleted = this.corridors[idx];
    this.corridors.splice(idx, 1);
    this.generateGraphSuggestions(deleted.floorId);
    this.saveToLocalStorage();
    this.notify();
  }

  // ── Door Management & Smart Graph Suggestions ────────────────
  public addDoor(door: Door): Door {
    this.saveSnapshotToUndo();
    this.doors.push(door);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_DOOR",
      entityType: "door",
      entityId: door.id,
      description: `Added ${door.type} "${door.name ?? door.id}"`,
      timestamp: Date.now(),
      newData: door,
    });
    this.generateGraphSuggestions(door.floorId);
    this.notify();
    return door;
  }

  public updateDoor(id: string, patch: Partial<Door>) {
    const idx = this.doors.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.doors[idx] = { ...this.doors[idx], ...patch };
    this.generateGraphSuggestions(this.doors[idx].floorId);
    this.notify();
  }

  public deleteDoor(id: string) {
    const idx = this.doors.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const deleted = this.doors[idx];
    this.doors.splice(idx, 1);
    this.generateGraphSuggestions(deleted.floorId);
    this.saveToLocalStorage();
    this.notify();
  }

  public generateGraphSuggestions(floorId: string) {
    this.suggestedNodes = [];
    this.suggestedEdges = [];
  }

  public acceptAllSuggestions() {
    if (this.suggestedNodes.length === 0 && this.suggestedEdges.length === 0) return;
    this.saveSnapshotToUndo();

    const nodeMap = new Map<string, string>();

    this.suggestedNodes.forEach((sug) => {
      const realNodeId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      nodeMap.set(sug.id, realNodeId);
      const permNode: Node = {
        id: realNodeId,
        floorId: sug.floorId,
        type: sug.type,
        name: sug.name,
        x: sug.x,
        y: sug.y,
      };
      this.nodes.push(permNode);

      const door = this.doors.find((d) => d.id === sug.sourceEntityId);
      if (door) door.connectedNodeId = realNodeId;
    });

    this.suggestedEdges.forEach((sugEdge) => {
      const fromId = nodeMap.get(sugEdge.from) ?? sugEdge.from;
      const toId = nodeMap.get(sugEdge.to) ?? sugEdge.to;
      const realEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      this.edges.push({
        id: realEdgeId,
        from: fromId,
        to: toId,
        type: sugEdge.type,
        distance: sugEdge.distance,
        bidirectional: true,
      });
    });

    this.suggestedNodes = [];
    this.suggestedEdges = [];
    this.notify();
  }

  public acceptSuggestion(id: string) {
    this.saveSnapshotToUndo();
    const sugNodeIdx = this.suggestedNodes.findIndex((sn) => sn.id === id);
    if (sugNodeIdx !== -1) {
      const sug = this.suggestedNodes[sugNodeIdx];
      const realNodeId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      this.nodes.push({
        id: realNodeId,
        floorId: sug.floorId,
        type: sug.type,
        name: sug.name,
        x: sug.x,
        y: sug.y,
      });
      const door = this.doors.find((d) => d.id === sug.sourceEntityId);
      if (door) door.connectedNodeId = realNodeId;
      this.suggestedNodes.splice(sugNodeIdx, 1);
      this.notify();
      return;
    }

    const sugEdgeIdx = this.suggestedEdges.findIndex((se) => se.id === id);
    if (sugEdgeIdx !== -1) {
      const sug = this.suggestedEdges[sugEdgeIdx];
      this.edges.push({
        id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        from: sug.from,
        to: sug.to,
        type: sug.type,
        distance: sug.distance,
        bidirectional: true,
      });
      this.suggestedEdges.splice(sugEdgeIdx, 1);
      this.notify();
    }
  }

  public rejectSuggestion(id: string) {
    this.suggestedNodes = this.suggestedNodes.filter((sn) => sn.id !== id);
    this.suggestedEdges = this.suggestedEdges.filter((se) => se.id !== id);
    this.notify();
  }

  public deleteSelectedEntities(ids: string[]) {
    if (!ids || ids.length === 0) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(ids);

    this.nodes = this.nodes.filter((n) => !idSet.has(n.id));
    this.edges = this.edges.filter((e) => !idSet.has(e.id) && !idSet.has(e.from) && !idSet.has(e.to));
    this.destinations = this.destinations.filter((d) => !idSet.has(d.id) && !idSet.has(d.nodeId));
    this.doors = this.doors.filter((d) => !idSet.has(d.id));
    this.corridors = this.corridors.filter((c) => !idSet.has(c.id));
    this.obstacles = this.obstacles.filter((o) => !idSet.has(o.id));
    this.events = this.events.filter((ev) => !idSet.has(ev.id));
    this.buildings = this.buildings.filter((b) => !idSet.has(b.id));

    this.saveToLocalStorage();
    this.notify();
  }

  // ── Copy & Paste Engine ────────────────────────────────────
  public copySelectedEntities(ids: string[]) {
    const idSet = new Set(ids);
    this.clipboardData = {
      nodes: this.nodes.filter((n) => idSet.has(n.id)),
      destinations: this.destinations.filter((d) => idSet.has(d.id)),
      doors: this.doors.filter((d) => idSet.has(d.id)),
      edges: this.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to)),
    };
  }

  public pasteEntities(targetFloorId: string, offset = { x: 30, y: 30 }) {
    if (!this.clipboardData) return [];
    this.saveSnapshotToUndo();

    const nodeMap = new Map<string, string>();
    const pastedNodeIds: string[] = [];

    (this.clipboardData.nodes || []).forEach((n) => {
      const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      nodeMap.set(n.id, newId);
      const copy: Node = { ...n, id: newId, floorId: targetFloorId, x: n.x + offset.x, y: n.y + offset.y };
      this.nodes.push(copy);
      pastedNodeIds.push(newId);
    });

    (this.clipboardData.destinations || []).forEach((d) => {
      const newDestId = `dest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const targetNodeId = nodeMap.get(d.nodeId) ?? d.nodeId;
      this.destinations.push({
        ...d,
        id: newDestId,
        nodeId: targetNodeId,
        floorId: targetFloorId,
        x: d.x ? d.x + offset.x : undefined,
        y: d.y ? d.y + offset.y : undefined,
      });
      pastedNodeIds.push(newDestId);
    });

    (this.clipboardData.doors || []).forEach((dr) => {
      const newDoorId = `door-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const connectedNodeId = dr.connectedNodeId ? nodeMap.get(dr.connectedNodeId) ?? dr.connectedNodeId : undefined;
      this.doors.push({
        ...dr,
        id: newDoorId,
        floorId: targetFloorId,
        x: dr.x + offset.x,
        y: dr.y + offset.y,
        connectedNodeId,
      });
      pastedNodeIds.push(newDoorId);
    });

    (this.clipboardData.edges || []).forEach((e) => {
      const newFrom = nodeMap.get(e.from);
      const newTo = nodeMap.get(e.to);
      if (newFrom && newTo) {
        this.edges.push({
          ...e,
          id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          from: newFrom,
          to: newTo,
        });
      }
    });

    this.notify();
    return pastedNodeIds;
  }

  // ── Bulk Editing Operations ──────────────────────────────
  public bulkDelete(ids: string[]) {
    if (ids.length === 0) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(ids);
    this.buildings = this.buildings.filter((b) => !idSet.has(b.id));
    this.floors = this.floors.filter((f) => !idSet.has(f.id));
    this.nodes = this.nodes.filter((n) => !idSet.has(n.id));
    this.edges = this.edges.filter((e) => !idSet.has(e.id) && !idSet.has(e.from) && !idSet.has(e.to));
    this.destinations = this.destinations.filter((d) => !idSet.has(d.id));
    this.doors = this.doors.filter((dr) => !idSet.has(dr.id));
    this.corridors = this.corridors.filter((c) => !idSet.has(c.id));
    this.obstacles = this.obstacles.filter((o) => !idSet.has(o.id));
    this.events = this.events.filter((ev) => !idSet.has(ev.id));
    this.saveToLocalStorage();
    this.notify();
  }

  public bulkUpdateCategory(destinationIds: string[], category: string) {
    if (destinationIds.length === 0) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(destinationIds);
    this.destinations.forEach((d) => {
      if (idSet.has(d.id)) d.category = category;
    });
    this.notify();
  }

  public bulkRename(entityIds: string[], baseName: string) {
    if (entityIds.length === 0 || !baseName.trim()) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(entityIds);
    let idx = 1;
    this.destinations.forEach((d) => {
      if (idSet.has(d.id)) {
        d.name = `${baseName} ${idx}`;
        idx++;
      }
    });
    this.nodes.forEach((n) => {
      if (idSet.has(n.id)) {
        n.name = `${baseName} Node ${idx}`;
        idx++;
      }
    });
    this.notify();
  }

  public clearAllData() {
    this.buildings = [];
    this.floors = [];
    this.nodes = [];
    this.edges = [];
    this.destinations = [];
    this.events = [];
    this.obstacles = [];
    this.stairGroups = [];
    this.liftGroups = [];
    this.corridors = [];
    this.doors = [];
    this.suggestedNodes = [];
    this.suggestedEdges = [];
    this.pendingChanges = [];
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  public deleteCheckpoint(checkpointId: string) {
    this.checkpoints = this.checkpoints.filter((c) => c.id !== checkpointId);
    this.saveToLocalStorage();
    this.notify();
  }

  private memoryDraft: string | null = null;

  // ── Draft Management Engine ────────────────────────────────
  public saveDraft(customName?: string) {
    const timestamp = Date.now();
    const existing = this.getSavedDraftMetadata();
    const draftName = customName || existing?.name || `Draft Saved (${new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    const draftPayload = {
      name: draftName,
      timestamp,
      snapshot: {
        buildings: this.buildings,
        floors: this.floors,
        nodes: this.nodes,
        edges: this.edges,
        destinations: this.destinations,
        events: this.events,
        obstacles: this.obstacles,
        stairGroups: this.stairGroups,
        liftGroups: this.liftGroups,
        doors: this.doors,
        corridors: this.corridors,
        pendingChanges: this.pendingChanges,
      },
      pendingChangesCount: this.pendingChanges.length,
    };
    try {
      this.memoryDraft = JSON.stringify(draftPayload);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("campusnav_explicit_draft_v2", JSON.stringify(draftPayload));
      }
      this.saveToLocalStorage();
      this.logAction("UPDATE", `Saved Draft "${draftName}"`);
      this.notify();
      return { success: true, timestamp, name: draftName };
    } catch (e) {
      console.warn("Failed to save explicit draft", e);
      return { success: false, timestamp, name: draftName };
    }
  }

  public getSavedDraftMetadata(): {
    name: string;
    timestamp: number;
    entityCount: number;
    pendingCount: number;
    breakdown: {
      buildings: number;
      floors: number;
      nodes: number;
      edges: number;
      destinations: number;
      events: number;
      obstacles: number;
      doors: number;
      lifts: number;
      corridors: number;
      stairs: number;
    };
  } | null {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem("campusnav_explicit_draft_v2") || this.memoryDraft : this.memoryDraft;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.snapshot) return null;
      const snapshot = parsed.snapshot;

      const breakdown = {
        buildings: snapshot.buildings?.length || 0,
        floors: snapshot.floors?.length || 0,
        nodes: snapshot.nodes?.length || 0,
        edges: snapshot.edges?.length || 0,
        destinations: snapshot.destinations?.length || 0,
        events: snapshot.events?.length || 0,
        obstacles: snapshot.obstacles?.length || 0,
        doors: snapshot.doors?.length || 0,
        lifts: snapshot.liftGroups?.length || 0,
        corridors: snapshot.corridors?.length || 0,
        stairs: snapshot.stairGroups?.length || 0,
      };

      const entityCount = Object.values(breakdown).reduce((a, b) => a + b, 0);

      return {
        name: parsed.name || "Saved Draft",
        timestamp: parsed.timestamp || Date.now(),
        entityCount,
        pendingCount: parsed.pendingChangesCount || snapshot.pendingChanges?.length || 0,
        breakdown,
      };
    } catch (e) {
      return null;
    }
  }

  public hasSavedDraft(): boolean {
    const meta = this.getSavedDraftMetadata();
    if (meta) return true;
    return this.hasUnsavedEdits();
  }

  public hasUnsavedEdits(): boolean {
    if (this.pendingChanges.length > 0) return true;
    if (
      this.buildings.length !== this.publishedGraph.buildings.length ||
      this.nodes.length !== this.publishedGraph.nodes.length ||
      this.edges.length !== this.publishedGraph.edges.length ||
      this.destinations.length !== this.publishedGraph.destinations.length ||
      this.doors.length !== (this.publishedGraph.doors?.length || 0) ||
      this.corridors.length !== (this.publishedGraph.corridors?.length || 0) ||
      this.liftGroups.length !== (this.publishedGraph.liftGroups?.length || 0)
    ) {
      return true;
    }
    return false;
  }

  public loadSavedDraft(): boolean {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem("campusnav_explicit_draft_v2") || this.memoryDraft : this.memoryDraft;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.snapshot) {
          const s = parsed.snapshot;
          this.saveSnapshotToUndo();
          if (Array.isArray(s.buildings)) this.buildings = s.buildings;
          if (Array.isArray(s.floors)) this.floors = s.floors;
          if (Array.isArray(s.nodes)) this.nodes = s.nodes;
          if (Array.isArray(s.edges)) this.edges = s.edges;
          if (Array.isArray(s.destinations)) this.destinations = s.destinations;
          if (Array.isArray(s.events)) this.events = s.events;
          if (Array.isArray(s.obstacles)) this.obstacles = s.obstacles;
          if (Array.isArray(s.stairGroups)) this.stairGroups = s.stairGroups;
          if (Array.isArray(s.liftGroups)) this.liftGroups = s.liftGroups;
          if (Array.isArray(s.doors)) this.doors = s.doors;
          if (Array.isArray(s.corridors)) this.corridors = s.corridors;
          if (Array.isArray(s.pendingChanges)) this.pendingChanges = s.pendingChanges;
          this.saveToLocalStorage();
          this.notify();
          return true;
        }
      }
      this.notify();
      return true;
    } catch (e) {
      console.warn("Failed to load saved draft", e);
      return false;
    }
  }

  public discardDraft() {
    this.saveSnapshotToUndo();
    this.memoryDraft = null;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem("campusnav_explicit_draft_v2");
        localStorage.removeItem("campusnav_working_store_v2");
      } catch (e) {}
    }
    if (this.publishedGraph.buildings && this.publishedGraph.buildings.length > 0) {
      this.buildings = JSON.parse(JSON.stringify(this.publishedGraph.buildings));
      this.floors = JSON.parse(JSON.stringify(this.publishedGraph.floors));
      this.nodes = JSON.parse(JSON.stringify(this.publishedGraph.nodes));
      this.edges = JSON.parse(JSON.stringify(this.publishedGraph.edges));
      this.destinations = JSON.parse(JSON.stringify(this.publishedGraph.destinations));
      this.events = JSON.parse(JSON.stringify(this.publishedGraph.events || []));
      this.obstacles = JSON.parse(JSON.stringify(this.publishedGraph.obstacles || []));
      this.stairGroups = JSON.parse(JSON.stringify(this.publishedGraph.stairGroups || []));
      this.liftGroups = JSON.parse(JSON.stringify(this.publishedGraph.liftGroups || []));
      this.doors = JSON.parse(JSON.stringify(this.publishedGraph.doors || []));
      this.corridors = JSON.parse(JSON.stringify(this.publishedGraph.corridors || []));
    } else {
      this.resetToInitialData();
      return;
    }
    this.pendingChanges = [];
    this.saveToLocalStorage();
    this.logAction("UPDATE", "Discarded Draft Edits");
    this.notify();
  }
}

// Global Singleton Store Instance
export const campusStore = new CampusStore();
