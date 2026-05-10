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
    // Run independently so a diagnostics failure doesn't blank the rows.
    const rows = await getWebsiteForms(from, to, clinic, service);
    let diagnostics: any = null;
    try {
      diagnostics = await getWebsiteDiagnostics(from, to);
    } catch (diagErr: any) {
      console.error("[/api/website-leads diagnostics]", diagErr?.message ?? diagErr);
      diagnostics = { _error: diagErr?.message ?? String(diagErr) };
    }
    return NextResponse.json({ rows, diagnostics });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[/api/website-leads]", msg, err?.stack ?? "");
    // Return _error so the UI can surface it instead of silently showing 0.
    return NextResponse.json({ rows: [], diagnostics: null, _error: msg }, { status: 200 });
  }
}
