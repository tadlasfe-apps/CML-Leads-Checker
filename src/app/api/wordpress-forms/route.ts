export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

// Deprecated — use /api/website-leads instead.
export async function GET() {
  return NextResponse.json([]);
}
