export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

// Deprecated — use DELETE /api/mappings/[id]?type=websiteFormName
export async function DELETE() {
  return NextResponse.json({ error: "Deprecated." }, { status: 410 });
}
