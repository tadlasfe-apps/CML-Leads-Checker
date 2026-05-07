import { NextRequest, NextResponse } from "next/server";
import { getServiceBreakdown } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const data = await getServiceBreakdown(
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
  );
  return NextResponse.json(data);
}
