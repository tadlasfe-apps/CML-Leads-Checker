export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWebsiteForms, getWebsiteDiagnostics } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from    = searchParams.get("from") || undefined;
  const to      = searchParams.get("to") || undefined;
  const clinic  = searchParams.get("clinic") || undefined;
  const service = searchParams.get("service") || undefined;
  try {
    const [rows, diagnostics] = await Promise.all([
      getWebsiteForms(from, to, clinic, service),
      getWebsiteDiagnostics(from, to),
    ]);
    return NextResponse.json({ rows, diagnostics });
  } catch (err: any) {
    console.error("[/api/website-leads]", err?.message ?? err);
    return NextResponse.json({ rows: [], diagnostics: null }, { status: 200 });
  }
}
