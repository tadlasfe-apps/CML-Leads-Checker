import { NextRequest, NextResponse } from "next/server";
import { getSourceComparison } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const data = await getSourceComparison(
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
    searchParams.get("clinic") || undefined,
    searchParams.get("service") || undefined,
  );
  return NextResponse.json(data);
}
