export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const [clinics, services] = await Promise.all([
    prisma.leadSourceRecord.findMany({
      where: { clinicLocationNormalized: { not: null } },
      select: { clinicLocationNormalized: true },
      distinct: ["clinicLocationNormalized"],
      orderBy: { clinicLocationNormalized: "asc" },
    }),
    prisma.leadSourceRecord.findMany({
      where: { serviceNormalized: { not: null } },
      select: { serviceNormalized: true },
      distinct: ["serviceNormalized"],
      orderBy: { serviceNormalized: "asc" },
    }),
  ]);

  return NextResponse.json({
    clinics:  clinics.map((r) => r.clinicLocationNormalized).filter(Boolean),
    services: services.map((r) => r.serviceNormalized).filter(Boolean),
  });
}
