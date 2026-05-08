export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getMetaBreakdown } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  try {
    return NextResponse.json(await getMetaBreakdown(
      searchParams.get("from") || undefined,
      searchParams.get("to") || undefined,
    ));
  } catch (err: any) {
    console.error("[/api/meta-leads]", err?.message ?? err);
    return NextResponse.json({ rows: [], totalLeads: 0, totalSpend: 0, byCampaign: [], byResultType: [] }, { status: 200 });
  }
}
