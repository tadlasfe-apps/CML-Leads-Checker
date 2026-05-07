import { NextRequest, NextResponse } from "next/server";
import { getWordPressFormLeads } from "@/lib/data";

export async function GET(req: NextRequest, { params }: { params: Promise<{ formName: string }> }) {
  const { searchParams } = req.nextUrl;
  const { formName: rawFormName } = await params;
  const formName = decodeURIComponent(rawFormName);
  const leads = await getWordPressFormLeads(
    formName,
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
  );
  return NextResponse.json(leads);
}
