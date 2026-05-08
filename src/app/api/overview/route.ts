import { NextRequest, NextResponse } from "next/server";
import { getOverviewKPIs, getLeadTimeline } from "@/lib/data";
import type { DateGrouping, ReportingTimezone } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from      = searchParams.get("from") || undefined;
  const to        = searchParams.get("to") || undefined;
  const clinic    = searchParams.get("clinic") || undefined;
  const service   = searchParams.get("service") || undefined;
  const groupBy   = (searchParams.get("groupBy") || "daily") as DateGrouping;
  const timezone  = (searchParams.get("timezone") || "America/Toronto") as ReportingTimezone;

  try {
    const [kpis, timeline] = await Promise.all([
      getOverviewKPIs(from, to, clinic, service),
      getLeadTimeline(from, to, groupBy, timezone, clinic, service),
    ]);
    return NextResponse.json({ kpis, timeline });
  } catch (err: any) {
    console.error("[/api/overview]", err?.message ?? err);
    return NextResponse.json({ kpis: null, timeline: [], _error: err?.message }, { status: 200 });
  }
}
