import { NextRequest, NextResponse } from "next/server";
import { getReconciliationLeads } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const data = await getReconciliationLeads(
    searchParams.get("status") || undefined,
    searchParams.get("source") || undefined,
    searchParams.get("clinic") || undefined,
    searchParams.get("service") || undefined,
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
    Number(searchParams.get("page") || 1),
  );
  return NextResponse.json(data);
}
