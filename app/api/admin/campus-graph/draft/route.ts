import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const draft = campusStore.getWorkingData();
    return NextResponse.json({ draft });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdminSession(req);
    const body = await req.json();
    if (body.snapshot) {
      campusStore.loadSnapshot(body.snapshot);
    }
    return NextResponse.json({ success: true, draft: campusStore.getWorkingData() });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
