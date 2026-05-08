import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  try {
    const [runs, settings] = await Promise.all([
      prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: limit }),
      prisma.integrationSettings.findMany(),
    ]);
    return NextResponse.json({ runs, settings });
  } catch (err: any) {
    console.error("[/api/api-syncs GET]", err?.message ?? err);
    return NextResponse.json({ runs: [], settings: [] }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sourceSystem, config } = body;

    if (action === "upsert-settings" && sourceSystem) {
      const record = await prisma.integrationSettings.upsert({
        where: { sourceSystem },
        create: { sourceSystem, config: config ?? {} },
        update: { config: config ?? {}, updatedAt: new Date() },
      });
      return NextResponse.json(record);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("[/api/api-syncs POST]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
