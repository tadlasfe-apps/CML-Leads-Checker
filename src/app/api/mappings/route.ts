import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const [clinics, services, sources] = await Promise.all([
    prisma.clinicMapping.findMany({ orderBy: { rawValue: "asc" } }),
    prisma.serviceMapping.findMany({ orderBy: { rawValue: "asc" } }),
    prisma.sourceMapping.findMany({ orderBy: { rawValue: "asc" } }),
  ]);
  return NextResponse.json({ clinics, services, sources });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, rawValue, normalizedValue } = body;

  if (!type || !rawValue || !normalizedValue) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  let record;
  if (type === "clinic") {
    record = await prisma.clinicMapping.upsert({
      where: { rawValue },
      create: { rawValue, normalizedValue },
      update: { normalizedValue },
    });
  } else if (type === "service") {
    record = await prisma.serviceMapping.upsert({
      where: { rawValue },
      create: { rawValue, normalizedValue },
      update: { normalizedValue },
    });
  } else if (type === "source") {
    record = await prisma.sourceMapping.upsert({
      where: { rawValue },
      create: { rawValue, normalizedValue },
      update: { normalizedValue },
    });
  } else {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  return NextResponse.json(record);
}
