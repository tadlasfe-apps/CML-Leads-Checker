export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getClinicBreakdown } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  try {
    return NextResponse.json(await getClinicBreakdown(
      searchParams.get("from") || undefined,
      searchParams.get("to") || undefined,
    ));
  } catch (err: any) {
    console.error("[/api/clinic-breakdown]", err?.message ?? err);
    return NextResponse.json([], { status: 200 });
  }
}
