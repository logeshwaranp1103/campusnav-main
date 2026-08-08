import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { campusStore } from "@/shared/lib/campus-store";
import { getRelationalGraphFromDatabase } from "@/lib/services/publish-service";

export async function GET() {
  try {
    if (prisma) {
      const [draftRecord, relationalGraph] = await Promise.all([
        prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null),
        getRelationalGraphFromDatabase().catch(() => null),
      ]);

      const snapshot = draftRecord?.snapshot as any;
      const snapshotNodeCount = snapshot?.nodes?.length ?? 0;
      const relationalNodeCount = relationalGraph?.nodes?.length ?? 0;

      if (relationalGraph && relationalNodeCount > snapshotNodeCount) {
        return NextResponse.json({ draft: relationalGraph });
      }

      if (snapshot && snapshotNodeCount > 0) {
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
      }
      campusStore.loadSnapshot(snapshot);
    }
    return NextResponse.json({ success: true, draft: snapshot });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
