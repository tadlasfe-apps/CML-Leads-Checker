export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSourceComparison, getSourceComparisonDrilldown, getSourceComparisonDims } from "@/lib/data";
import type { DateGrouping, ReportingTimezone, ComparisonDimension } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from        = searchParams.get("from") || undefined;
  const to          = searchParams.get("to") || undefined;
  const clinic      = searchParams.get("clinic") || undefined;
  const service     = searchParams.get("service") || undefined;
  const groupBy     = (searchParams.get("groupBy") || "daily") as DateGrouping;
  const timezone    = (searchParams.get("timezone") || "America/Toronto") as ReportingTimezone;
  const adAccountId = searchParams.get("adAccountId") || undefined;
  // Dimension grouping: "date" | "date+clinic" | "date+service" | "date+clinic+service"
  const dimensionGroupBy = (searchParams.get("dimensionGroupBy") || "date") as ComparisonDimension;

  try {
    if (searchParams.get("drilldown") === "true") {
      const periodStart = searchParams.get("periodStart") || from || "";
      const periodEnd   = searchParams.get("periodEnd") || to || "";
      const by = (searchParams.get("by") || "clinic") as "clinic" | "service" | "websiteFormSource" | "campaign";
      return NextResponse.json(await getSourceComparisonDrilldown(periodStart, periodEnd, by));
    }

    // Multi-dimensional mode when dimensionGroupBy includes clinic or service
    if (dimensionGroupBy !== "date") {
      const { rows, diagnostics } = await getSourceComparisonDims(
        from, to, groupBy, timezone, clinic, service, dimensionGroupBy, adAccountId,
      );
      return NextResponse.json({ rows, diagnostics });
    }

    // Date-only mode (existing behavior)
    const rows = await getSourceComparison(from, to, groupBy, timezone, clinic, service, adAccountId);
    return NextResponse.json({ rows });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[/api/source-comparison]", msg, err?.stack ?? "");
    return NextResponse.json({ rows: [], _error: msg }, { status: 200 });
  }
}
