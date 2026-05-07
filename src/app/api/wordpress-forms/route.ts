import { NextRequest, NextResponse } from "next/server";
import { getWordPressForms } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const data = await getWordPressForms(
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
  );
  return NextResponse.json(data);
}
