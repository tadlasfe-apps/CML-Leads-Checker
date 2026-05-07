import { NextRequest, NextResponse } from "next/server";
import { getOverviewKPIs, getLeadTimelineData } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  const [kpis, timeline] = await Promise.all([
    getOverviewKPIs(from, to),
    getLeadTimelineData(from, to),
  ]);

  return NextResponse.json({ kpis, timeline });
}
