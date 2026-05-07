import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");
  const { id } = await params;

  try {
    if (type === "clinic") await prisma.clinicMapping.delete({ where: { id } });
    else if (type === "service") await prisma.serviceMapping.delete({ where: { id } });
    else if (type === "source") await prisma.sourceMapping.delete({ where: { id } });
    else return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
