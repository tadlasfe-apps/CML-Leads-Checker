export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSourceComparison, getSourceComparisonDrilldown } from "@/lib/data";
import type { DateGrouping, ReportingTimezone } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from     = searchParams.get("from") || undefined;
  const to       = searchParams.get("to") || undefined;
  const clinic   = searchParams.get("clinic") || undefined;
  const service  = searchParams.get("service") || undefined;
  const groupBy  = (searchParams.get("groupBy") || "daily") as DateGrouping;
  const timezone = (searchParams.get("timezone") || "America/Toronto") as ReportingTimezone;

  try {
    if (searchParams.get("drilldown") === "true") {
      const periodStart = searchParams.get("periodStart") || from || "";
      const periodEnd   = searchParams.get("periodEnd") || to || "";
      const by = (searchParams.get("by") || "clinic") as "clinic" | "service" | "websiteFormSource" | "campaign";
      return NextResponse.json(await getSourceComparisonDrilldown(periodStart, periodEnd, by));
    }
    return NextResponse.json(await getSourceComparison(from, to, groupBy, timezone, clinic, service));
  } catch (err: any) {
    console.error("[/api/source-comparison]", err?.message ?? err);
    return NextResponse.json([], { status: 200 });
  }
}
