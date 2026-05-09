export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST() {
  try {
    const result = await prisma.leadSourceRecord.deleteMany({
      where: { sourceSystem: "META" },
    });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (err: any) {
    console.error("[/api/sync/meta/clear]", err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to clear Meta records" },
      { status: 200 },
    );
  }
}
