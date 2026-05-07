import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const [runs, settings] = await Promise.all([
    prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    prisma.integrationSettings.findMany(),
  ]);

  return NextResponse.json({ runs, settings });
}

export async function POST(req: NextRequest) {
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
}
