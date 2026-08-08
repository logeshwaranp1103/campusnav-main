import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { campusStore } from "@/shared/lib/campus-store";
import { getRelationalGraphFromDatabase } from "@/lib/services/publish-service";

export async function GET() {
  try {
    if (prisma) {
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      });

      const relationalGraph = await getRelationalGraphFromDatabase();

      if (draftRecord && draftRecord.snapshot) {
        const snapshot = { ...(draftRecord.snapshot as any) };
        if (relationalGraph && relationalGraph.buildings) {
          const snapshotBldMap = new Map((snapshot.buildings || []).map((b: any) => [b.id, b]));
          relationalGraph.buildings.forEach((rb: any) => {
            if (!snapshotBldMap.has(rb.id)) {
              snapshotBldMap.set(rb.id, rb);
            }
          });
          snapshot.buildings = Array.from(snapshotBldMap.values());
        }
        return NextResponse.json({ draft: snapshot });
      }

      if (relationalGraph) {
        return NextResponse.json({ draft: relationalGraph });
      }
    }
    const draft = campusStore.getWorkingData();
    return NextResponse.json({ draft });
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
        await prisma.draftGraph.upsert({
          where: { id: "active-draft" },
          update: { snapshot: snapshot as any },
          create: { id: "active-draft", snapshot: snapshot as any },
        });

        if (snapshot.buildings && Array.isArray(snapshot.buildings)) {
          const ops = snapshot.buildings.map((b: any) =>
            prisma.building.upsert({
              where: { id: b.id },
              update: {
                campusId: b.campusId || "c1",
                name: b.name,
                shortCode: b.shortCode || b.id,
                color: b.color || "#4f46e5",
                description: b.description || null,
                x: b.x ?? null,
                y: b.y ?? null,
                width: b.width ?? null,
                height: b.height ?? null,
                status: "DRAFT",
              },
              create: {
                id: b.id,
                campusId: b.campusId || "c1",
                name: b.name,
                shortCode: b.shortCode || b.id,
                color: b.color || "#4f46e5",
                description: b.description || null,
                x: b.x ?? null,
                y: b.y ?? null,
                width: b.width ?? null,
                height: b.height ?? null,
                status: "DRAFT",
              },
            })
          );
          await prisma.$transaction(ops);
        }
      }
      campusStore.loadSnapshot(snapshot);
    }
    return NextResponse.json({ success: true, draft: snapshot });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
