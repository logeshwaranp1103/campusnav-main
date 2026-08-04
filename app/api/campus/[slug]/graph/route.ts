import { NextResponse } from "next/server";
import { campusStore } from "@/shared/lib/campus-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const publishedData = campusStore.getPublishedData();
  const version = campusStore.getPublishedVersion();

  return NextResponse.json({
    slug,
    version,
    data: publishedData,
  });
}
