import { NextRequest, NextResponse } from "next/server";
import { getWebsiteForms } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  try {
    return NextResponse.json(await getWebsiteForms(
      searchParams.get("from") || undefined,
      searchParams.get("to") || undefined,
      searchParams.get("clinic") || undefined,
      searchParams.get("service") || undefined,
    ));
  } catch (err: any) {
    console.error("[/api/website-leads]", err?.message ?? err);
    return NextResponse.json([], { status: 200 });
  }
}
