import { NextResponse } from "next/server";
import { campusStore } from "@/shared/lib/campus-store";
import { getActivePublishedGraph } from "@/lib/services/publish-service";

export async function GET() {
  const publishedServiceData = getActivePublishedGraph();
  const publishedStoreData = campusStore.getPublishedData();

  const data = publishedServiceData?.snapshot ?? publishedStoreData;

  return NextResponse.json(
    {
      publishedAt: publishedServiceData?.publishedAt ?? new Date(),
      version: publishedServiceData?.version ?? 1,
      graph: data,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=10, s-maxage=60",
      },
    }
  );
}
