export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServiceBreakdown } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  try {
    return NextResponse.json(await getServiceBreakdown(
      searchParams.get("from") || undefined,
      searchParams.get("to") || undefined,
      searchParams.get("clinic") || undefined,
    ));
  } catch (err: any) {
    console.error("[/api/service-breakdown]", err?.message ?? err);
    return NextResponse.json([], { status: 200 });
  }
}
