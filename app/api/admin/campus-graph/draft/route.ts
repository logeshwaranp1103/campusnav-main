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
    // No draft in DB — return empty graph
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
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const snapshot = body.snapshot || body.draft;
    if (snapshot) {
      if (prisma) {
        // Save the full snapshot JSON
        await prisma.draftGraph.upsert({
          where: { id: "active-draft" },
          update: { snapshot: snapshot as any },
          create: { id: "active-draft", snapshot: snapshot as any },
        });

        // Sync buildings to relational table: delete removed, upsert current
        if (snapshot.buildings && Array.isArray(snapshot.buildings)) {
          const currentBldIds = snapshot.buildings.map((b: any) => b.id);

          // Delete buildings no longer in the snapshot
          if (currentBldIds.length > 0) {
            await prisma.building.deleteMany({
              where: { id: { notIn: currentBldIds } },
            });
          }

          // Upsert current buildings
          const defaultCampusId = "c1";
          // Ensure campus exists
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
          });

          for (const b of snapshot.buildings) {
            await prisma.building.upsert({
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
              },
            });
          }
        }
      }
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

