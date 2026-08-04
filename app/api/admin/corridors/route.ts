import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { logAuditEvent } from "@/lib/services/audit-service";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const corridors = campusStore.getWorkingData().corridors;
    return NextResponse.json({ corridors });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json();

    if (!body.floorId || !body.points || body.points.length < 2) {
      return NextResponse.json({ error: "floorId and points array (at least 2 points) are required." }, { status: 400 });
    }

    const corridor = campusStore.addCorridor({
      id: body.id || `corr-${Date.now().toString(36)}`,
      floorId: body.floorId,
      name: body.name || "Corridor Path",
      points: body.points,
      width: body.width || 30,
    });

    await logAuditEvent({
      userId: user.id,
      action: "CORRIDOR_CREATED",
      resource: "corridor",
      resourceId: corridor.id,
      after: corridor,
    });

    return NextResponse.json({ success: true, corridor });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
