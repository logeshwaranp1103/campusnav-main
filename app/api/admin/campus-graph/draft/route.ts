import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    if (prisma) {
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      });

      if (draftRecord && draftRecord.snapshot) {
        return NextResponse.json({ draft: draftRecord.snapshot });
      }
    }
    // No draft in DB — return empty graph structure
    return NextResponse.json({
      draft: {
        buildings: [],
        floors: [],
        nodes: [],
        edges: [],
        destinations: [],
        obstacles: [],
        events: [],
        stairGroups: [],
        liftGroups: [],
        doors: [],
        corridors: [],
      },
    });
  } catch (err: unknown) {
    console.warn("Notice: GET /api/admin/campus-graph/draft database offline:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      draft: null,
      offline: true,
      message: "Database temporary connection issue, using client store",
    });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const snapshot = body.snapshot || body.draft;
    if (snapshot && prisma) {
      // Save the full snapshot JSON
      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: snapshot as any },
        create: { id: "active-draft", snapshot: snapshot as any },
      });

        // Sync buildings to relational table (best-effort)
        try {
          const defaultCampusId = "c1";
          await prisma.campus.upsert({
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
          }).catch(() => {});

          const currentBldIds = snapshot.buildings.map((b: any) => b.id);
          if (currentBldIds.length > 0) {
            await prisma.building.deleteMany({
              where: { id: { notIn: currentBldIds } },
            }).catch(() => {});
          }

          for (const b of snapshot.buildings) {
            // Ensure shortCode is unique per building ID to satisfy @@unique([campusId, shortCode])
            const safeCode = b.shortCode ? `${b.shortCode}_${b.id.slice(-6)}` : b.id;
            await prisma.building.upsert({
              where: { id: b.id },
              update: {
                campusId: b.campusId || defaultCampusId,
                name: b.name,
                shortCode: safeCode,
                color: b.color || "#4f46e5",
                description: b.description || null,
                x: b.x ?? null,
                y: b.y ?? null,
                width: b.width ?? null,
                height: b.height ?? null,
                floorsCount: b.floorsCount ?? 0,
                basementsCount: b.basementsCount ?? 0,
              },
              create: {
                id: b.id,
                campusId: b.campusId || defaultCampusId,
                name: b.name,
                shortCode: safeCode,
                color: b.color || "#4f46e5",
                description: b.description || null,
                x: b.x ?? null,
                y: b.y ?? null,
                width: b.width ?? null,
                height: b.height ?? null,
                floorsCount: b.floorsCount ?? 0,
                basementsCount: b.basementsCount ?? 0,
              },
            }).catch((e) => console.warn(`Relational sync deferred for building ${b.id}:`, e?.message));
          }
        } catch (syncErr) {
          console.warn("Relational building sync notice:", syncErr);
        }
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.warn("Notice: PUT /api/admin/campus-graph/draft database offline:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, offline: true, message: "Draft stored in local memory" });
  }
}

