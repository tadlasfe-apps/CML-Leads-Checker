import { NextRequest, NextResponse } from "next/server";
import { getSourceComparison, getSourceComparisonDrilldown } from "@/lib/data";
import type { DateGrouping, ReportingTimezone } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const clinic = searchParams.get("clinic") || undefined;
  const service = searchParams.get("service") || undefined;
  const groupBy = (searchParams.get("groupBy") || "daily") as DateGrouping;
  const timezone = (searchParams.get("timezone") || "America/Toronto") as ReportingTimezone;

  // Drilldown mode: ?drilldown=true&periodStart=...&periodEnd=...&by=clinic
  const drilldown = searchParams.get("drilldown") === "true";
  if (drilldown) {
    const periodStart = searchParams.get("periodStart") || from || "";
    const periodEnd = searchParams.get("periodEnd") || to || "";
    const by = (searchParams.get("by") || "clinic") as "clinic" | "service" | "websiteFormSource" | "campaign";
    const data = await getSourceComparisonDrilldown(periodStart, periodEnd, by);
    return NextResponse.json(data);
  }

  const data = await getSourceComparison(from, to, groupBy, timezone, clinic, service);
  return NextResponse.json(data);
}
