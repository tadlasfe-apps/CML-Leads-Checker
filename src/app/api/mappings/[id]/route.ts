export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");
  const { id } = await params;

  try {
    if (type === "clinic") await prisma.clinicMapping.delete({ where: { id } });
    else if (type === "service") await prisma.serviceMapping.delete({ where: { id } });
    else if (type === "websiteFormSource") await prisma.websiteFormSourceMapping.delete({ where: { id } });
    else if (type === "websiteFormName") await prisma.websiteFormNameMapping.delete({ where: { id } });
    else if (type === "metaLocation") await prisma.metaLocationMapping.delete({ where: { id } });
    else return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
