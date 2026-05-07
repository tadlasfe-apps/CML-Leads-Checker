import { NextResponse } from "next/server";

// Deprecated — use /api/mappings with type=websiteFormName instead.
export async function GET() {
  return NextResponse.json([]);
}

export async function POST() {
  return NextResponse.json({ error: "Deprecated. Use POST /api/mappings with type=websiteFormName." }, { status: 410 });
}
