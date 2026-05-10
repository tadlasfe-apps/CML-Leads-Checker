export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSourceComparison, getSourceComparisonDrilldown } from "@/lib/data";
import type { DateGrouping, ReportingTimezone } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from        = searchParams.get("from") || undefined;
  const to          = searchParams.get("to") || undefined;
  const clinic      = searchParams.get("clinic") || undefined;
  const service     = searchParams.get("service") || undefined;
  const groupBy     = (searchParams.get("groupBy") || "daily") as DateGrouping;
  const timezone    = (searchParams.get("timezone") || "America/Toronto") as ReportingTimezone;
  const adAccountId = searchParams.get("adAccountId") || undefined;

  try {
    if (searchParams.get("drilldown") === "true") {
      const periodStart = searchParams.get("periodStart") || from || "";
      const periodEnd   = searchParams.get("periodEnd") || to || "";
      const by = (searchParams.get("by") || "clinic") as "clinic" | "service" | "websiteFormSource" | "campaign";
      return NextResponse.json(await getSourceComparisonDrilldown(periodStart, periodEnd, by));
    }
    // Always return { rows, _error? } shape so the page can distinguish errors from empty results.
    const rows = await getSourceComparison(from, to, groupBy, timezone, clinic, service, adAccountId);
    return NextResponse.json({ rows });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[/api/source-comparison]", msg, err?.stack ?? "");
    return NextResponse.json({ rows: [], _error: msg }, { status: 200 });
  }
}
